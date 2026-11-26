# Weekly dinner planner on the Raspberry Pi

Every Sunday morning the Pi picks the week's dinners, saves the plan to Doug's List,
and pings your phone. The app puts the meals on the Market Basket list the next time it opens.

## 1. Phone: install ntfy
Install **ntfy** (free) from the App Store / Play Store. Tap **+**, subscribe to a topic with a
hard-to-guess name, e.g. `dougslist-7f3k9q2m`. Anyone who knows the name can read it, so make it random.

## 2. Pi: get the script
```bash
mkdir -p ~/dougslist-planner && cd ~/dougslist-planner
curl -fsSLO https://raw.githubusercontent.com/taptheash/dougslist/main/pi/plan_week.py
```

## 3. Pi: settings file
```bash
nano ~/dougslist-planner/planner.env
```
```
ANTHROPIC_API_KEY=sk-ant-...your key...
NTFY_TOPIC=dougslist-7f3k9q2m
```
```bash
chmod 600 ~/dougslist-planner/planner.env
```

## 4. Test it
```bash
python3 ~/dougslist-planner/plan_week.py --dry-run
```
It prints the dinners it would pick and changes nothing.

## 5. Schedule it (Sundays 7:05 AM)
Make sure the Pi is on Eastern time: `timedatectl` (fix with `sudo timedatectl set-timezone America/New_York`).
```bash
crontab -e
```
Add this line:
```
5 7 * * 0 /usr/bin/python3 /home/$USER/dougslist-planner/plan_week.py >> /home/$USER/dougslist-planner/plan.log 2>&1
```
(Replace `$USER` with your Pi username if cron doesn't expand it.)

## Handy
- `--force` re-plans this week even if it's already planned.
- The app's planner settings (on/off, number of dinners) are respected.
- Log: `tail ~/dougslist-planner/plan.log`
