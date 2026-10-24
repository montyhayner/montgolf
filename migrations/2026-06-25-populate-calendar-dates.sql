WITH RECURSIVE dates(d) AS (
    VALUES('2026-01-01')
    UNION ALL
    SELECT date(d, '+1 day')
    FROM dates
    WHERE d < '2026-12-31'
)
INSERT OR IGNORE INTO calendar_dates (date, day_of_week)
SELECT
    d,
    CAST(strftime('%w', d) AS INTEGER)
FROM dates;
