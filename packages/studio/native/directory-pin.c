#include <node_api.h>
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>

typedef struct {
  HANDLE handle;
} directory_pin;

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
  // directory read access, while allowing child reads/writes and denying
  // DELETE access to this specific directory pathname.
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

NAPI_MODULE_INIT() {
  // Security protocol v2 specifically means the handle requests
  // FILE_LIST_DIRECTORY (share-enforced) and does NOT grant FILE_SHARE_DELETE.
  // The JavaScript loader rejects old metadata-only binaries before apply.
  napi_value version;
  if (napi_create_uint32(env, 2, &version) != napi_ok ||
      napi_set_named_property(env, exports, "pinContractVersion", version) != napi_ok) {
    napi_throw_error(env, NULL, "Creating native pin security contract failed");
    return NULL;
  }
  napi_property_descriptor functions[] = {
    {"open", NULL, open_directory, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, close_directory, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(functions)/sizeof(functions[0]), functions);
  return exports;
}
