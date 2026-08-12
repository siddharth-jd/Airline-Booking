# SQL practice — quick reference

A sandbox database (`practice_db`) exists for learning SQL. The `practice` role
has **no access** to `auth_db`, `flights_db` or `bookings_db`, so nothing done
here can damage the project.

## Every practice session — the whole routine

1. Open a terminal (VS Code: `Ctrl` + `` ` ``).
2. Run `sqlpractice`
3. The prompt becomes `practice_db=#`. Write SQL.
4. `\q` to leave.

Everything created persists between sessions. Postgres restarts by itself after
a reboot (`restart: unless-stopped` + systemd), so normally there is nothing to
start manually.

**If `sqlpractice` says "connection refused"** — the container is not running:

```bash
cd ~/projects/airline-booking && docker compose up -d
```

Wait a few seconds, then `sqlpractice` again.

## Connecting

```bash
psql -h localhost -U practice -d practice_db      # password: practice_pw
```

To avoid typing the password every time, add it to `~/.pgpass`:

```bash
echo "localhost:5432:*:practice:practice_pw" >> ~/.pgpass
chmod 600 ~/.pgpass
```

Handy alias — add to `~/.bashrc`, then `source ~/.bashrc`:

```bash
alias sqlpractice='psql -h localhost -U practice -d practice_db'
```

If `psql` is not installed yet:

```bash
sudo apt update && sudo apt install -y postgresql-client
```

Without the client installed, go through the container instead:

```bash
docker exec -it -e PGPASSWORD=practice_pw airline-postgres \
  psql -U practice -d practice_db
```

## The two things that will trip you up most

### 1. Single quotes for text, always

PostgreSQL follows the SQL standard strictly, and MySQL does not:

| Quote  | PostgreSQL means            | MySQL means   |
|--------|-----------------------------|---------------|
| `'Mj'` | a string **value**          | a string value |
| `"Mj"` | the **name** of a column    | a string value |

So this fails in Postgres and works in the video:

```sql
INSERT INTO student (rollno, name) VALUES (102, "Mj");
-- ERROR: column "Mj" does not exist
```

Postgres went looking for a *column* called `Mj`. The fix is single quotes:

```sql
INSERT INTO student (rollno, name) VALUES (102, 'Mj');
```

**Rule: text data always gets single quotes.**

### 2. Read the prompt — it tells you what psql is waiting for

| Prompt          | Meaning                    | What to do |
|-----------------|----------------------------|------------|
| `practice_db=>` | ready                      | type away  |
| `practice_db->` | waiting for a `;`          | type `;`   |
| `practice_db'>` | unclosed `'` quote         | **Ctrl+C** |
| `practice_db">` | unclosed `"` quote         | **Ctrl+C** |
| `practice_db(>` | unclosed `(` bracket       | **Ctrl+C** |

`Ctrl+C` abandons the half-typed statement and returns a clean prompt. It does
not quit psql and does not lose any tables.

A statement can span as many lines as you like — psql only runs it when it sees
the `;`. That is why a missing semicolon leaves you at `->` seemingly stuck.

## Following a MySQL course in PostgreSQL

Almost everything transfers. These are the commands that do not:

| MySQL (in the video)             | PostgreSQL                  |
|----------------------------------|-----------------------------|
| `SHOW DATABASES;`                | `\l`                        |
| `USE classroom;`                 | `\c classroom`              |
| `SHOW TABLES;`                   | `\dt`                       |
| `DESC student;`                  | `\d student`                |
| `SHOW COLUMNS FROM student;`     | `\d student`                |
| `INT AUTO_INCREMENT PRIMARY KEY` | `SERIAL PRIMARY KEY`        |
| `` `backticks` ``                | `"double quotes"`, or none  |
| `ENUM('a','b')`                  | `TEXT CHECK (x IN ('a','b'))` |
| `IFNULL(a, b)`                   | `COALESCE(a, b)`            |
| `CONCAT(a, b)`                   | `a \|\| b` (`CONCAT` also works) |
| `NOW()`                          | `now()` (both work)         |
| `LIMIT 10, 5`                    | `LIMIT 5 OFFSET 10`         |

Identical in both: `CREATE DATABASE`, `CREATE TABLE`, `INSERT`, `SELECT`,
`WHERE`, `ORDER BY`, `GROUP BY`, `HAVING`, `JOIN`, `UPDATE`, `DELETE`,
`ALTER TABLE`, `DROP`, `PRIMARY KEY`, `FOREIGN KEY`, `NOT NULL`, `UNIQUE`,
`CHECK`, `DEFAULT`, `COUNT`/`SUM`/`AVG`/`MIN`/`MAX`, subqueries, `DISTINCT`,
`BETWEEN`, `IN`, `LIKE`, `AS`.

## psql survival kit

| Command      | Does                                          |
|--------------|-----------------------------------------------|
| `\l`         | list databases                                |
| `\c dbname`  | connect to another database                   |
| `\dt`        | list tables in the current database           |
| `\d table`   | describe a table (columns, indexes, keys)     |
| `\du`        | list roles/users                              |
| `\x`         | toggle expanded output — wide rows become readable |
| `\e`         | open the last query in an editor              |
| `\i file.sql`| run a `.sql` file                             |
| `\timing`    | toggle query timing                           |
| `\?`         | help on backslash commands                    |
| `\h SELECT`  | SQL syntax help for a statement               |
| `\q`         | quit                                          |

Statements must end with `;`. If the prompt shows `dbname-#` instead of
`dbname=#`, psql is still waiting for that semicolon.

## Running a saved .sql file

Writing practice queries in a file is often nicer than retyping them:

```bash
psql -h localhost -U practice -d practice_db -f myqueries.sql
```

or from inside psql: `\i myqueries.sql`

## Resetting

```sql
DROP DATABASE classroom;      -- drop a practice database you created
CREATE DATABASE classroom;    -- and start again
```

Note: `docker compose down -v` deletes the Postgres volume entirely, which
recreates `practice_db` **empty** and loses practice tables. Plain
`docker compose down` keeps everything.
