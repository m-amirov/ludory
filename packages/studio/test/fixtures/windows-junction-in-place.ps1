param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [ValidateSet('Full', 'Attributes')][string]$AccessMode = 'Full'
)

# Test-only NTFS adversarial probe. Unlike mklink /J, this writes a mount-point
# reparse tag onto an EXISTING empty directory without renaming its pathname.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class LudoryJunctionProbe {
  private const uint GENERIC_READ_WRITE = 0xC0000000;
  private const uint FILE_SHARE_ALL = 7;
  private const uint OPEN_EXISTING = 3;
  private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
  private const uint FSCTL_SET_REPARSE_POINT = 0x000900A4;
  private const uint IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003;

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFileW(string filename, uint access, uint share,
      IntPtr security, uint disposition, uint flags, IntPtr template);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeviceIoControl(SafeFileHandle handle, uint control,
      byte[] input, uint inputLength, IntPtr output, uint outputLength,
      out uint returned, IntPtr overlapped);

  public static bool SetInPlace(string source, string target, bool attributesOnly, out int error) {
    error = 0;
    byte[] name = Encoding.Unicode.GetBytes(@"\??\" + Path.GetFullPath(target));
    if (name.Length + 12 > UInt16.MaxValue) {
      error = 87;
      return false;
    }
    // REPARSE_DATA_BUFFER, MountPointReparseBuffer:
    // tag(4), dataLength(2), reserved(2), offsets/lengths(8),
    // UTF16 substitute + NUL followed by the empty print-name NUL.
    byte[] input = new byte[16 + name.Length + 4];
    Array.Copy(BitConverter.GetBytes(IO_REPARSE_TAG_MOUNT_POINT), 0, input, 0, 4);
    Array.Copy(BitConverter.GetBytes((ushort)(name.Length + 12)), 0, input, 4, 2);
    Array.Copy(BitConverter.GetBytes((ushort)0), 0, input, 8, 2);
    Array.Copy(BitConverter.GetBytes((ushort)name.Length), 0, input, 10, 2);
    Array.Copy(BitConverter.GetBytes((ushort)(name.Length + 2)), 0, input, 12, 2);
    Array.Copy(name, 0, input, 16, name.Length);

    using (SafeFileHandle handle = CreateFileW(source, attributesOnly ? 0x100U : GENERIC_READ_WRITE,
        FILE_SHARE_ALL, IntPtr.Zero, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero)) {
      if (handle.IsInvalid) {
        error = Marshal.GetLastWin32Error();
        return false;
      }
      uint returned;
      bool success = DeviceIoControl(handle, FSCTL_SET_REPARSE_POINT,
          input, (uint)input.Length, IntPtr.Zero, 0, out returned, IntPtr.Zero);
      if (!success) error = Marshal.GetLastWin32Error();
      return success;
    }
  }
}
'@
  $code = 0
  if ([LudoryJunctionProbe]::SetInPlace($Source, $Target, $AccessMode -eq 'Attributes', [ref]$code)) {
    Write-Output 'CREATED'
    exit 0
  }
  Write-Output "BLOCKED:$code"
  exit 2
} catch {
  [Console]::Error.WriteLine($_.ToString())
  exit 3
}
