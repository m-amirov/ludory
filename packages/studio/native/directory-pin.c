#include <node_api.h>
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <wchar.h>

typedef struct {
  HANDLE handle;
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
  if (!CloseHandle(guard->handle)) return throw_native(env, "Closing removed anchored guard", GetLastError());
  guard->handle = INVALID_HANDLE_VALUE;
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

NAPI_MODULE_INIT() {
  // Security protocol v4 additionally requires a held handle-relative guard
  // file in each directory before any operation can temporarily empty it.
  // Earlier binary versions allowed the confirmed transient NTFS escape.
  napi_value version;
  if (napi_create_uint32(env, 4, &version) != napi_ok ||
      napi_set_named_property(env, exports, "pinContractVersion", version) != napi_ok) {
    napi_throw_error(env, NULL, "Creating native pin security contract failed");
    return NULL;
  }
  napi_property_descriptor functions[] = {
    {"open", NULL, open_directory, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, close_directory, NULL, NULL, NULL, napi_default, NULL},
    {"createGuard", NULL, create_guard, NULL, NULL, NULL, napi_default, NULL},
    {"removeGuard", NULL, remove_guard, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(functions)/sizeof(functions[0]), functions);
  return exports;
}
