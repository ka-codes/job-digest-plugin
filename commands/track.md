---
description: Update an application's status in applications.json
argument-hint: role:<role id> status:<not_applied|applied|interviewing|offer|rejected|withdrawn>
---
Read applications.json in the current folder. If no application record exists for the given role id, create one. Update its status, set status_date to today, and append an entry to its history array. Write the file back. Confirm the change to the user in one line.
