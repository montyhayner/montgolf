WITH last AS (
    SELECT COALESCE(MAX(date), date('now', '-1 day')) AS max_date
    FROM calendar_dates
),
target AS (
    SELECT date('now', '+14 months', '-1 day') AS target_date
),
dates(d) AS (
    SELECT date(max_date, '+1 day')
    FROM last
    UNION ALL
    SELECT date(d, '+1 day')
    FROM dates, target
    WHERE d < target_date
)
INSERT OR IGNORE INTO calendar_dates (date, day_of_week)
SELECT
    d,
    CAST(strftime('%w', d) AS INTEGER)
FROM dates;
