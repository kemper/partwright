// Ambient declarations for the parts of the File System Access API that are
// NOT in TypeScript's standard lib.dom.d.ts. The core handle interfaces
// (FileSystemDirectoryHandle / FileSystemFileHandle / FileSystemWritableFileStream)
// ship with lib.dom for OPFS; the disk *picker* on Window and the per-handle
// permission methods are non-standard extensions from the WICG spec, so we
// declare only those here via interface merging. Feature-detected at runtime —
// these types describe the Chromium-only surface, not a support guarantee.

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: string | FileSystemHandle;
}

interface Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
}
