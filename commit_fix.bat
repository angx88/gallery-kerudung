@echo off
cd /d "C:\project\gallery-kerudung"
echo === STATUS SEBELUM === > commit_log.txt
git status >> commit_log.txt 2>&1
echo. >> commit_log.txt
echo === ADD === >> commit_log.txt
git add -A >> commit_log.txt 2>&1
echo. >> commit_log.txt
echo === COMMIT === >> commit_log.txt
git commit -m "fix: kasbon & gaji hilang karena cache belum lengkap saat load awal" >> commit_log.txt 2>&1
echo. >> commit_log.txt
echo === PUSH === >> commit_log.txt
git push >> commit_log.txt 2>&1
echo. >> commit_log.txt
echo === SELESAI ===  >> commit_log.txt
