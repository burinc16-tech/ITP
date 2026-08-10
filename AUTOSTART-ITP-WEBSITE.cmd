@echo off
REM Auto-starts the ITP/ITR website server when Windows starts.
REM Lives in the Startup folder; launches START-WEBSITE.cmd minimized.
REM
REM NOTE: the folder name contains "&". Never pass this path inside
REM   cmd /c "..." - cmd strips the outer quotes and treats & as a
REM   command separator, so the launch silently fails. Instead we set
REM   the working directory with START's /D switch and call the script
REM   by its bare name.
start "ITP Website" /min /d "C:\Users\Burin Chotwatanakul\OneDrive\Desktop\Claude Working Folder\ITP & ITR" cmd /c START-WEBSITE.cmd
