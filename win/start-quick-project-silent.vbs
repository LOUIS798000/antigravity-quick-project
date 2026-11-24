Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeScript = scriptDir & "\bin\antigravity-quick-project-patch.js"
nodeExe = ""

' 1. 优先读取 install.ps1 写入的 node.exe 绝对路径
nodePathFile = scriptDir & "\node_path.txt"
If fso.FileExists(nodePathFile) Then
    On Error Resume Next
    Set ts = fso.OpenTextFile(nodePathFile, 1)
    If Not ts.AtEndOfStream Then
        savedPath = Trim(ts.ReadLine())
        If fso.FileExists(savedPath) Then
            nodeExe = savedPath
        End If
    End If
    ts.Close
    On Error GoTo 0
End If

' 2. 常见 Node.js 安装路径兜底
If nodeExe = "" Then
    candidates = Array( _
        "D:\Program Files\nodejs\node.exe", _
        "C:\Program Files\nodejs\node.exe", _
        WshShell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
        WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe"), _
        WshShell.ExpandEnvironmentStrings("%APPDATA%\nvm\current\node.exe") _
    )
    For Each c In candidates
        If c <> "" And fso.FileExists(c) Then
            nodeExe = c
            Exit For
        End If
    Next
End If

' 3. PATH 兜底
If nodeExe = "" Then
    nodeExe = "node.exe"
End If

' 4. 后台常驻守护（限制 48MB 堆上限，意外退出或热更新时 3 秒自动复活）
Do
    exitCode = WshShell.Run("""" & nodeExe & """ --max-old-space-size=48 """ & nodeScript & """ --watch", 0, True)
    WScript.Sleep 3000
Loop
