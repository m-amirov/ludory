#include <node_api.h>
#include <windows.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <stdio.h>
#include <wchar.h>
#include <string.h>

typedef struct {
  HANDLE handle;
  int deletion_marked;
} directory_pin;

// Stable NT native handle-relative create ABI. RootDirectory is the pinned
// physical directory HANDLE, not an attacker-changeable pathname.
typedef struct { USHORT Length; USHORT MaximumLength; wchar_t* Buffer; } pin_unicode;
typedef struct {
  ULONG Length; HANDLE RootDirectory; pin_unicode* ObjectName; ULONG Attributes;
  void* SecurityDescriptor; void* SecurityQualityOfService;
} pin_object_attributes;
typedef struct {
  union { LONG Status; void* Pointer; } u;
  ULONG_PTR Information;
} pin_io_status;
typedef LONG (NTAPI *pin_nt_create_file)(HANDLE*, ACCESS_MASK, pin_object_attributes*,
    pin_io_status*, LARGE_INTEGER*, ULONG, ULONG, ULONG, ULONG, void*, ULONG);

static void finalize_pin(napi_env env, void* data, void* hint) {
  directory_pin* pin = (directory_pin*) data;
  if (pin != NULL) {
    if (pin->handle != INVALID_HANDLE_VALUE) CloseHandle(pin->handle);
    free(pin);
  }
}

static napi_value throw_native(napi_env env, const char* action, DWORD code) {
  char message[160];
  snprintf(message, sizeof(message), "%s: Win32 error %lu", action, (unsigned long)code);
  napi_throw_error(env, "LUDORY_WIN32_PIN", message);
  return NULL;
}

static napi_value open_directory(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  napi_valuetype type;
  if (argc != 1 || napi_typeof(env, args[0], &type) != napi_ok || type != napi_string) {
    napi_throw_type_error(env, NULL, "Directory pin requires a path string");
    return NULL;
  }

  size_t length = 0;
  if (napi_get_value_string_utf16(env, args[0], NULL, 0, &length) != napi_ok || length > 32767) {
    napi_throw_range_error(env, NULL, "Invalid directory pin path length");
    return NULL;
  }
  wchar_t* filename = (wchar_t*)calloc(length + 1, sizeof(wchar_t));
  if (filename == NULL) return throw_native(env, "Allocating directory path", ERROR_OUTOFMEMORY);
  size_t actual = 0;
  if (napi_get_value_string_utf16(env, args[0], (char16_t*)filename, length + 1, &actual) != napi_ok || actual != length) {
    free(filename);
    napi_throw_error(env, NULL, "Invalid UTF-16 directory path");
    return NULL;
  }

  // FILE_READ_ATTRIBUTES alone is a metadata-only open: Windows can bypass
  // its sharing restrictions and rename the directory. Request actual
  // directory read access and deny DELETE sharing. Legitimate NTFS child
  // renames REQUIRE WRITE sharing; handle-relative nondeletable guard files
  // ensure each held directory cannot become empty for an in-place junction.
  HANDLE handle = CreateFileW(filename, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  free(filename);
  if (handle == INVALID_HANDLE_VALUE) return throw_native(env, "Opening protected directory", GetLastError());

  BY_HANDLE_FILE_INFORMATION identity;
  if (!GetFileInformationByHandle(handle, &identity)) {
    DWORD code = GetLastError();
    CloseHandle(handle);
    return throw_native(env, "Inspecting protected directory", code);
  }
  if (!(identity.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
      (identity.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    CloseHandle(handle);
    napi_throw_error(env, "LUDORY_WIN32_PIN", "Pinned target is not a physical directory");
    return NULL;
  }
  directory_pin* pin = (directory_pin*)calloc(1, sizeof(directory_pin));
  if (pin == NULL) {
    CloseHandle(handle);
    return throw_native(env, "Allocating pin handle", ERROR_OUTOFMEMORY);
  }
  pin->handle = handle;
  napi_value token, file_id, result;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_bigint_uint64(env, ((uint64_t)identity.nFileIndexHigh << 32) | identity.nFileIndexLow, &file_id) != napi_ok) {
    finalize_pin(env, pin, NULL);
    napi_throw_error(env, NULL, "Creating protected directory result failed");
    return NULL;
  }
  if (napi_create_external(env, pin, finalize_pin, NULL, &token) != napi_ok) {
    finalize_pin(env, pin, NULL);
    napi_throw_error(env, NULL, "Creating protected directory handle failed");
    return NULL;
  }
  napi_set_named_property(env, result, "token", token);
  napi_set_named_property(env, result, "fileId", file_id);
  return result;
}

static napi_value close_directory(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  directory_pin* pin = NULL;
  if (argc != 1 || napi_get_value_external(env, args[0], (void**)&pin) != napi_ok || pin == NULL) {
    napi_throw_type_error(env, NULL, "Directory close requires a native token");
    return NULL;
  }
  if (pin->handle != INVALID_HANDLE_VALUE) {
    if (!CloseHandle(pin->handle)) return throw_native(env, "Closing protected directory", GetLastError());
    pin->handle = INVALID_HANDLE_VALUE;
  }
  napi_value undefined_value;
  napi_get_undefined(env, &undefined_value);
  return undefined_value;
}

// Create an unremovable child atomically RELATIVE TO the held directory inode.
// This avoids resolving a full pathname that could have just become a junction.
// The returned handle denies FILE_SHARE_DELETE for its entire lifetime.
static napi_value create_guard(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  directory_pin* parent = NULL;
  napi_valuetype type;
  if (argc != 2 || napi_get_value_external(env, args[0], (void**)&parent) != napi_ok ||
      parent == NULL || parent->handle == INVALID_HANDLE_VALUE ||
      napi_typeof(env, args[1], &type) != napi_ok || type != napi_string) {
    napi_throw_type_error(env, NULL, "Guard creation requires a live directory pin and guard name");
    return NULL;
  }
  size_t length = 0;
  if (napi_get_value_string_utf16(env, args[1], NULL, 0, &length) != napi_ok || length >= 100) {
    napi_throw_range_error(env, NULL, "Invalid native guard name length");
    return NULL;
  }
  wchar_t filename[100] = {0};
  size_t actual = 0;
  if (napi_get_value_string_utf16(env, args[1], (char16_t*)filename, 100, &actual) != napi_ok || actual != length) {
    napi_throw_type_error(env, NULL, "Invalid native guard UTF-16 name");
    return NULL;
  }
  const wchar_t* prefix = L".ludory-components-guard-";
  size_t prefix_length = wcslen(prefix);
  if (length != prefix_length + 32 || wcsncmp(filename, prefix, prefix_length) != 0) {
    napi_throw_type_error(env, NULL, "Native guard requires the reserved randomized basename");
    return NULL;
  }
  for (size_t i = prefix_length; i < length; i++) {
    if (!((filename[i] >= L'0' && filename[i] <= L'9') ||
          (filename[i] >= L'a' && filename[i] <= L'f'))) {
      napi_throw_type_error(env, NULL, "Native guard nonce must be lowercase hex");
      return NULL;
    }
  }
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  pin_nt_create_file create_file = ntdll == NULL ? NULL :
      (pin_nt_create_file)GetProcAddress(ntdll, "NtCreateFile");
  if (create_file == NULL) return throw_native(env, "Resolving NtCreateFile", GetLastError());
  pin_unicode name = { (USHORT)(length * sizeof(wchar_t)),
      (USHORT)((length + 1) * sizeof(wchar_t)), filename };
  pin_object_attributes attributes = { sizeof(pin_object_attributes), parent->handle,
      &name, 0x40 | 0x1000 /* OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE */, NULL, NULL };
  pin_io_status status = {0};
  HANDLE handle = INVALID_HANDLE_VALUE;
  LONG outcome = create_file(&handle, FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES |
      DELETE | SYNCHRONIZE, &attributes, &status, NULL,
      FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      2 /* FILE_CREATE: do not overwrite existing pathname */,
      0x40 | 0x20 /* FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT */,
      NULL, 0);
  if (outcome < 0 || handle == INVALID_HANDLE_VALUE) {
    char message[160];
    snprintf(message, sizeof(message), "Creating anchored guard: NTSTATUS 0x%08lx", (unsigned long)outcome);
    napi_throw_error(env, "LUDORY_WIN32_GUARD", message);
    return NULL;
  }
  directory_pin* guard = (directory_pin*)calloc(1, sizeof(directory_pin));
  if (guard == NULL) {
    CloseHandle(handle);
    return throw_native(env, "Allocating native guard handle", ERROR_OUTOFMEMORY);
  }
  guard->handle = handle;
  BY_HANDLE_FILE_INFORMATION identity;
  if (!GetFileInformationByHandle(handle, &identity) ||
      !(identity.dwFileAttributes & FILE_ATTRIBUTE_HIDDEN) ||
      (identity.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) {
    DWORD code = GetLastError();
    finalize_pin(env, guard, NULL);
    return throw_native(env, "Inspecting anchored guard", code == 0 ? ERROR_INVALID_DATA : code);
  }
  napi_value result, token, file_id;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_bigint_uint64(env, ((uint64_t)identity.nFileIndexHigh << 32) | identity.nFileIndexLow,
        &file_id) != napi_ok ||
      napi_create_external(env, guard, finalize_pin, NULL, &token) != napi_ok) {
    finalize_pin(env, guard, NULL);
    napi_throw_error(env, NULL, "Creating native guard result failed");
    return NULL;
  }
  napi_set_named_property(env, result, "token", token);
  napi_set_named_property(env, result, "fileId", file_id);
  return result;
}

static napi_value remove_guard(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  directory_pin* guard = NULL;
  if (argc != 1 || napi_get_value_external(env, args[0], (void**)&guard) != napi_ok ||
      guard == NULL || guard->handle == INVALID_HANDLE_VALUE) {
    napi_throw_type_error(env, NULL, "Guard removal requires a live native handle");
    return NULL;
  }
  FILE_DISPOSITION_INFO disposition = { TRUE };
  if (!SetFileInformationByHandle(guard->handle, FileDispositionInfo, &disposition, sizeof(disposition))) {
    return throw_native(env, "Marking anchored guard for deletion", GetLastError());
  }
  guard->deletion_marked = 1;
  if (!CloseHandle(guard->handle)) return throw_native(env, "Closing removed anchored guard", GetLastError());
  guard->handle = INVALID_HANDLE_VALUE;
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

// A successful delete disposition is irreversible publication for recovery.
// Expose the marker even when the subsequent CloseHandle reports an error.
static napi_value is_deletion_marked(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  directory_pin* pin = NULL;
  if (argc != 1 || napi_get_value_external(env, args[0], (void**)&pin) != napi_ok || pin == NULL) {
    napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Deletion marker requires a native file token");
    return NULL;
  }
  napi_value result;
  napi_get_boolean(env, pin->deletion_marked != 0, &result);
  return result;
}

// Recovery records are deliberately restricted to per-project digest names.
// All NT opens below resolve the basename relative to a held physical root,
// with OBJ_DONT_REPARSE. No caller-supplied path can reach this API.
static int recovery_name(napi_env env, napi_value value, wchar_t filename[100], int purpose) {
  napi_valuetype type;
  size_t length = 0, actual = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf16(env, value, NULL, 0, &length) != napi_ok || length >= 100 ||
      napi_get_value_string_utf16(env, value, (char16_t*)filename, 100, &actual) != napi_ok || actual != length) {
    napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Recovery requires a valid reserved basename");
    return 0;
  }
  if (length < 69) {
    napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Recovery basename is too short");
    return 0;
  }
  for (size_t i = 0; i < 64; i++) {
    if (!((filename[i] >= L'0' && filename[i] <= L'9') ||
          (filename[i] >= L'a' && filename[i] <= L'f'))) {
      napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Recovery basename requires lowercase SHA-256");
      return 0;
    }
  }
  const wchar_t* suffix = filename + 64;
  int is_lock = wcscmp(suffix, L".json.lock") == 0;
  int is_record = wcscmp(suffix, L".recovery.json") == 0;
  int is_pin = wcscmp(suffix, L".json") == 0;
  if (!((purpose == 0 && (is_lock || is_record || is_pin)) ||
        (purpose == 1 && is_lock) || (purpose == 2 && is_record))) {
    napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Recovery basename suffix is not permitted");
    return 0;
  }
  return 1;
}

static directory_pin* recovery_parent(napi_env env, napi_value value) {
  directory_pin* parent = NULL;
  if (napi_get_value_external(env, value, (void**)&parent) != napi_ok ||
      parent == NULL || parent->handle == INVALID_HANDLE_VALUE) {
    napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Recovery requires a live native directory pin");
    return NULL;
  }
  return parent;
}

static LONG open_relative_recovery(HANDLE parent, wchar_t* filename, HANDLE* opened,
    ACCESS_MASK rights, ULONG disposition, ULONG attributes) {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  pin_nt_create_file create_file = ntdll == NULL ? NULL :
      (pin_nt_create_file)GetProcAddress(ntdll, "NtCreateFile");
  if (create_file == NULL) return (LONG)0xC0000002; // STATUS_NOT_IMPLEMENTED
  size_t length = wcslen(filename);
  pin_unicode name = { (USHORT)(length * sizeof(wchar_t)),
      (USHORT)((length + 1) * sizeof(wchar_t)), filename };
  pin_object_attributes object = { sizeof(pin_object_attributes), parent,
      &name, 0x40 | 0x1000 /* OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE */, NULL, NULL };
  pin_io_status io = {0};
  // A reader must share DELETE with our own held create token (which requests
  // DELETE for handle-relative rollback); it does not itself request DELETE.
  // Exclusive creators continue to deny deletion sharing to other writers.
  ULONG sharing = disposition == 1 /* FILE_OPEN */
      ? FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
      : FILE_SHARE_READ | FILE_SHARE_WRITE;
  return create_file(opened, rights | SYNCHRONIZE, &object, &io, NULL, attributes,
      sharing, disposition,
      0x40 | 0x20 | 0x00200000 /* NON_DIRECTORY | SYNCHRONOUS | OPEN_REPARSE_POINT */,
      NULL, 0);
}

static napi_value throw_recovery_status(napi_env env, const char* operation, LONG code) {
  char message[180];
  snprintf(message, sizeof(message), "%s: NTSTATUS 0x%08lx", operation, (unsigned long)code);
  napi_throw_error(env, "LUDORY_WIN32_RECOVERY", message);
  return NULL;
}

static int checked_recovery_file(HANDLE handle, BY_HANDLE_FILE_INFORMATION* identity) {
  return GetFileInformationByHandle(handle, identity) &&
      !(identity->dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) &&
      identity->nNumberOfLinks == 1;
}

static void discard_created_recovery(HANDLE handle) {
  FILE_DISPOSITION_INFO disposition = { TRUE };
  SetFileInformationByHandle(handle, FileDispositionInfo, &disposition, sizeof(disposition));
  CloseHandle(handle);
}

static napi_value recovery_created_token(napi_env env, HANDLE handle,
    BY_HANDLE_FILE_INFORMATION* identity) {
  directory_pin* file = (directory_pin*)calloc(1, sizeof(directory_pin));
  if (file == NULL) {
    discard_created_recovery(handle);
    return throw_native(env, "Allocating native recovery file", ERROR_OUTOFMEMORY);
  }
  file->handle = handle;
  napi_value result, token, file_id;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_bigint_uint64(env, ((uint64_t)identity->nFileIndexHigh << 32) |
        identity->nFileIndexLow, &file_id) != napi_ok) {
    discard_created_recovery(handle);
    file->handle = INVALID_HANDLE_VALUE;
    free(file);
    napi_throw_error(env, "LUDORY_WIN32_RECOVERY", "Creating native recovery result failed");
    return NULL;
  }
  if (napi_create_external(env, file, finalize_pin, NULL, &token) != napi_ok) {
    discard_created_recovery(handle);
    file->handle = INVALID_HANDLE_VALUE;
    free(file);
    napi_throw_error(env, "LUDORY_WIN32_RECOVERY", "Creating native recovery handle failed");
    return NULL;
  }
  napi_set_named_property(env, result, "token", token);
  napi_set_named_property(env, result, "fileId", file_id);
  return result;
}

static napi_value create_recovery_file(napi_env env, napi_callback_info info, int is_lock) {
  napi_value args[3];
  size_t argc = 3;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc != (is_lock ? 2u : 3u)) {
    napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Invalid native recovery create arguments");
    return NULL;
  }
  directory_pin* parent = recovery_parent(env, args[0]);
  if (parent == NULL) return NULL;
  wchar_t filename[100] = {0};
  if (!recovery_name(env, args[1], filename, is_lock ? 1 : 2)) return NULL;
  void* bytes = NULL;
  size_t bytes_length = 0;
  if (!is_lock) {
    bool is_buffer = false;
    if (napi_is_buffer(env, args[2], &is_buffer) != napi_ok || !is_buffer ||
        napi_get_buffer_info(env, args[2], &bytes, &bytes_length) != napi_ok ||
        bytes_length == 0 || bytes_length > 8192) {
      napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Recovery record must be a Buffer of at most 8192 bytes");
      return NULL;
    }
  }
  HANDLE handle = INVALID_HANDLE_VALUE;
  LONG status = open_relative_recovery(parent->handle, filename, &handle,
      FILE_READ_ATTRIBUTES | FILE_WRITE_DATA | DELETE, 2 /* FILE_CREATE, exclusive */,
      FILE_ATTRIBUTE_HIDDEN);
  if (status < 0 || handle == INVALID_HANDLE_VALUE) {
    return throw_recovery_status(env, "Creating anchored recovery file", status);
  }
  BY_HANDLE_FILE_INFORMATION identity;
  if (!checked_recovery_file(handle, &identity)) {
    discard_created_recovery(handle);
    return throw_native(env, "Inspecting anchored recovery file", ERROR_INVALID_DATA);
  }
  if (!is_lock) {
    DWORD written = 0;
    if (!WriteFile(handle, bytes, (DWORD)bytes_length, &written, NULL) || written != bytes_length) {
      DWORD code = GetLastError();
      discard_created_recovery(handle);
      return throw_native(env, "Writing anchored recovery file", code == 0 ? ERROR_WRITE_FAULT : code);
    }
  }
  if (!FlushFileBuffers(handle)) {
    DWORD code = GetLastError();
    discard_created_recovery(handle);
    return throw_native(env, "Flushing anchored recovery file", code);
  }
  return recovery_created_token(env, handle, &identity);
}

static napi_value create_recovery_lock(napi_env env, napi_callback_info info) {
  return create_recovery_file(env, info, 1);
}

static napi_value create_recovery_record(napi_env env, napi_callback_info info) {
  return create_recovery_file(env, info, 0);
}

static napi_value read_recovery_record(napi_env env, napi_callback_info info) {
  napi_value args[2];
  size_t argc = 2;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc != 2) {
    napi_throw_type_error(env, "LUDORY_WIN32_RECOVERY", "Invalid native recovery read arguments");
    return NULL;
  }
  directory_pin* parent = recovery_parent(env, args[0]);
  if (parent == NULL) return NULL;
  wchar_t filename[100] = {0};
  if (!recovery_name(env, args[1], filename, 0)) return NULL;
  HANDLE handle = INVALID_HANDLE_VALUE;
  LONG status = open_relative_recovery(parent->handle, filename, &handle,
      FILE_READ_DATA | FILE_READ_ATTRIBUTES, 1 /* FILE_OPEN */, FILE_ATTRIBUTE_NORMAL);
  if (status == (LONG)0xC0000034 || status == (LONG)0xC000003A || status == (LONG)0xC000000F) {
    napi_value missing;
    napi_get_null(env, &missing);
    return missing;
  }
  if (status < 0 || handle == INVALID_HANDLE_VALUE) {
    return throw_recovery_status(env, "Reading anchored recovery file", status);
  }
  BY_HANDLE_FILE_INFORMATION identity;
  LARGE_INTEGER length;
  if (!checked_recovery_file(handle, &identity) ||
      !GetFileSizeEx(handle, &length) || length.QuadPart < 0 || length.QuadPart > 8192) {
    CloseHandle(handle);
    return throw_native(env, "Inspecting anchored recovery record", ERROR_INVALID_DATA);
  }
  char bytes[8192];
  DWORD read = 0;
  if (!ReadFile(handle, bytes, (DWORD)length.QuadPart, &read, NULL) || read != length.QuadPart) {
    DWORD code = GetLastError();
    CloseHandle(handle);
    return throw_native(env, "Reading anchored recovery bytes", code == 0 ? ERROR_READ_FAULT : code);
  }
  LARGE_INTEGER after;
  if (!GetFileSizeEx(handle, &after) || after.QuadPart != length.QuadPart) {
    CloseHandle(handle);
    return throw_native(env, "Verifying anchored recovery size", ERROR_INVALID_DATA);
  }
  CloseHandle(handle);
  napi_value result;
  if (napi_create_buffer_copy(env, (size_t)read, bytes, NULL, &result) != napi_ok) {
    napi_throw_error(env, "LUDORY_WIN32_RECOVERY", "Returning anchored recovery bytes failed");
    return NULL;
  }
  return result;
}

NAPI_MODULE_INIT() {
  // Security protocol v6 requires a native post-delete disposition marker;
  // v5 already supported handle-relative host recovery lock/read/write.
  // v4 also requires a held handle-relative guard
  // file in each directory before any operation can temporarily empty it.
  // Earlier binary versions allowed the confirmed transient NTFS escape.
  napi_value version;
  if (napi_create_uint32(env, 6, &version) != napi_ok ||
      napi_set_named_property(env, exports, "pinContractVersion", version) != napi_ok) {
    napi_throw_error(env, NULL, "Creating native pin security contract failed");
    return NULL;
  }
  napi_property_descriptor functions[] = {
    {"open", NULL, open_directory, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, close_directory, NULL, NULL, NULL, napi_default, NULL},
    {"createGuard", NULL, create_guard, NULL, NULL, NULL, napi_default, NULL},
    {"removeGuard", NULL, remove_guard, NULL, NULL, NULL, napi_default, NULL},
    {"isDeletionMarked", NULL, is_deletion_marked, NULL, NULL, NULL, napi_default, NULL},
    {"createRecoveryLock", NULL, create_recovery_lock, NULL, NULL, NULL, napi_default, NULL},
    {"readRecoveryRecord", NULL, read_recovery_record, NULL, NULL, NULL, napi_default, NULL},
    {"createRecoveryRecord", NULL, create_recovery_record, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(functions)/sizeof(functions[0]), functions);
  return exports;
}
