Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Progetti\Achats"
WshShell.Run """C:\Program Files\nodejs\node.exe"" server.js", 0, False
