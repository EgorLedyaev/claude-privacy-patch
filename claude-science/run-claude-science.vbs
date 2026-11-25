Set oShell = CreateObject("WScript.Shell")
Set oEnv = oShell.Environment("PROCESS")

oEnv("HTTP_PROXY") = "http://127.0.0.1:10809"
oEnv("HTTPS_PROXY") = "http://127.0.0.1:10809"
oEnv("NO_PROXY") = "localhost,127.0.0.1"

appDir = oShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\ClaudeScience")
oShell.CurrentDirectory = appDir
oShell.Run """" & appDir & "\claude-science.exe""", 1, False
