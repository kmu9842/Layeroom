using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class InstallLocation {
    static string Settings(string packageRoot){return Path.Combine(packageRoot,"Layeroom.settings.json");}
    public static string Read(string packageRoot) {
        string file=Settings(packageRoot);
        if(!File.Exists(file))return packageRoot;
        var settings=new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(File.ReadAllText(file,Encoding.UTF8));
        string folder;
        return settings.TryGetValue("install_folder",out folder)?Path.GetFullPath(Path.Combine(packageRoot,folder)):packageRoot;
    }
    public static void Save(string packageRoot,string folder) {
        string value=String.Equals(Path.GetFullPath(packageRoot).TrimEnd('\\'),Path.GetFullPath(folder).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase)?".":Path.GetFullPath(folder);
        File.WriteAllText(Settings(packageRoot),new JavaScriptSerializer().Serialize(new Dictionary<string,string>{{"install_folder",value}}),new UTF8Encoding(false));
    }
}

// Windows' native Explorer dialog, including address bar, sidebar and New Folder.
internal static class FolderPicker {
    [ComImport,Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]class FileOpenDialog {}
    [ComImport,Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog {
        [PreserveSig]int Show(IntPtr owner);
        void SetFileTypes(uint count,IntPtr types);void SetFileTypeIndex(uint index);void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events,out uint cookie);void Unadvise(uint cookie);
        void SetOptions(uint options);void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);void SetFolder(IShellItem folder);void GetFolder(out IShellItem folder);void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)]string name);void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)]string title);void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)]string text);void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)]string text);
        void GetResult(out IShellItem item);
    }
    [ComImport,Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler(IntPtr context,ref Guid handler,ref Guid iid,out IntPtr result);
        void GetParent(out IShellItem parent);void GetDisplayName(uint type,out IntPtr name);void GetAttributes(uint mask,out uint attributes);void Compare(IShellItem other,uint hint,out int order);
    }
    [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=false)]
    static extern void SHCreateItemFromParsingName(string path,IntPtr bindContext,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IShellItem item);
    public static string Choose(IntPtr owner,string initial) {
        var dialog=(IFileDialog)new FileOpenDialog();
        IShellItem initialItem=null,result=null;
        try {
            uint options;dialog.GetOptions(out options);dialog.SetOptions(options|0x20u|0x40u|0x800u|0x8u); // folders, filesystem, existing path, preserve cwd
            dialog.SetTitle("Layeroom 설치 폴더 선택");dialog.SetOkButtonLabel("이 폴더 선택");
            if(Directory.Exists(initial)){var iid=typeof(IShellItem).GUID;SHCreateItemFromParsingName(initial,IntPtr.Zero,ref iid,out initialItem);dialog.SetFolder(initialItem);}
            int status=dialog.Show(owner);if(status==unchecked((int)0x800704C7))return null;Marshal.ThrowExceptionForHR(status);
            dialog.GetResult(out result);IntPtr name;result.GetDisplayName(0x80058000,out name);
            try{return Marshal.PtrToStringUni(name);}finally{Marshal.FreeCoTaskMem(name);}
        } finally {if(result!=null)Marshal.ReleaseComObject(result);if(initialItem!=null)Marshal.ReleaseComObject(initialItem);Marshal.ReleaseComObject(dialog);}
    }
}
