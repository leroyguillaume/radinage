use crate::domain::import_profile::CsvDelimiter;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportParams {
    pub label_col: usize,
    pub amount_col: usize,
    pub date_col: usize,
    pub date_format: String,
    /// Number of leading rows to skip before the first data row (default 0).
    /// This count includes the header row if present.
    pub skip_lines: usize,
    /// Field separator of CSV files (default `comma`); spreadsheets ignore it.
    #[serde(default)]
    pub csv_delimiter: CsvDelimiter,
}

#[derive(Debug, Clone)]
pub struct ParsedRow {
    pub label: String,
    pub amount: Decimal,
    pub date: NaiveDate,
    /// 1-based row number in the source file.
    pub row: usize,
}

/// An error encountered on a specific row during file import.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RowError {
    /// 1-based row number where the error occurred.
    pub row: usize,
    /// Human-readable description of what went wrong.
    pub reason: String,
}

pub struct ImportResult {
    pub rows: Vec<ParsedRow>,
    pub errors: Vec<RowError>,
}

/// Parse a CSV byte slice into rows.
pub fn parse_csv(data: &[u8], params: &ImportParams) -> ImportResult {
    // Skip the first `skip_lines` lines before handing data to the CSV reader.
    let effective_data = skip_leading_lines(data, params.skip_lines);

    let mut reader = csv_reader(effective_data, params.csv_delimiter);

    let mut rows = Vec::new();
    let mut errors = Vec::new();

    let row_offset = params.skip_lines;
    for (idx, result) in reader.records().enumerate() {
        let row_num = idx + 1 + row_offset; // 1-based, after skipped lines
        match result {
            Err(e) => errors.push(RowError {
                row: row_num,
                reason: format!("CSV parse error: {e}"),
            }),
            Ok(record) => match parse_record(&record, params, row_num) {
                Ok(parsed) => rows.push(parsed),
                Err(e) => errors.push(e),
            },
        }
    }

    ImportResult { rows, errors }
}

/// Whether a file is read as a spreadsheet rather than as CSV, judging by its name.
pub fn is_spreadsheet(file_name: &str) -> bool {
    file_name.ends_with(".xlsx") || file_name.ends_with(".xls")
}

/// Parse an XLSX byte slice into rows.
pub fn parse_xlsx(data: &[u8], params: &ImportParams) -> ImportResult {
    let range = match first_sheet(data) {
        Ok(r) => r,
        Err(reason) => {
            return ImportResult {
                rows: Vec::new(),
                errors: vec![RowError { row: 0, reason }],
            };
        }
    };

    let mut rows = Vec::new();
    let mut errors = Vec::new();
    // Skip `skip_lines` leading rows (header included in count)
    let skip_count = params.skip_lines;
    for (row_idx, row) in range.rows().enumerate().skip(skip_count) {
        let row_num = row_idx + 1; // 1-based
        match parse_xlsx_row(row, params, row_num) {
            Ok(parsed) => rows.push(parsed),
            Err(e) => errors.push(e),
        }
    }

    ImportResult { rows, errors }
}

fn csv_reader(data: &[u8], delimiter: CsvDelimiter) -> csv::Reader<&[u8]> {
    csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter.as_byte())
        .from_reader(data)
}

/// The first `limit` rows of a file as text, cell by cell, with nothing skipped: what an import
/// reads before the profile picks its columns. `delimiter` only applies to CSV.
pub fn preview_rows(
    data: &[u8],
    spreadsheet: bool,
    delimiter: CsvDelimiter,
    limit: usize,
) -> Result<Vec<Vec<String>>, String> {
    if spreadsheet {
        let range = first_sheet(data)?;
        return Ok(range
            .rows()
            .take(limit)
            .map(|row| row.iter().map(xlsx_cell_text).collect())
            .collect());
    }
    csv_reader(data, delimiter)
        .records()
        .take(limit)
        .map(|record| {
            record
                .map(|r| r.iter().map(|cell| cell.trim().to_string()).collect())
                .map_err(|e| format!("CSV parse error: {e}"))
        })
        .collect()
}

fn first_sheet(data: &[u8]) -> Result<calamine::Range<calamine::Data>, String> {
    use calamine::{Reader, open_workbook_auto_from_rs};
    use std::io::Cursor;

    let mut workbook = open_workbook_auto_from_rs(Cursor::new(data))
        .map_err(|e| format!("Failed to open workbook: {e}"))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "No sheets found".to_string())?;
    workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| format!("Failed to read sheet: {e}"))
}

fn xlsx_cell_text(cell: &calamine::Data) -> String {
    match cell {
        calamine::Data::DateTime(dt) => dt
            .as_datetime()
            .map_or_else(|| dt.to_string(), |d| d.date().to_string()),
        other => other.to_string(),
    }
}

/// Skip the first `n` lines from a byte slice and return the remainder.
fn skip_leading_lines(data: &[u8], n: usize) -> &[u8] {
    if n == 0 {
        return data;
    }
    let mut skipped = 0;
    for (i, &byte) in data.iter().enumerate() {
        if byte == b'\n' {
            skipped += 1;
            if skipped == n {
                return &data[i + 1..];
            }
        }
    }
    // If we couldn't skip enough lines, return empty slice
    &data[data.len()..]
}

fn parse_record(
    record: &csv::StringRecord,
    params: &ImportParams,
    row_num: usize,
) -> Result<ParsedRow, RowError> {
    let label = get_col(record, params.label_col, row_num, "label")?;
    let amount_str = get_col(record, params.amount_col, row_num, "amount")?;
    let date_str = get_col(record, params.date_col, row_num, "date")?;

    let amount = parse_amount(&amount_str, row_num)?;
    let date = parse_date(&date_str, &params.date_format, row_num)?;

    Ok(ParsedRow {
        label,
        amount,
        date,
        row: row_num,
    })
}

fn get_col(
    record: &csv::StringRecord,
    col: usize,
    row_num: usize,
    field: &str,
) -> Result<String, RowError> {
    record
        .get(col)
        .map(|s| s.trim().to_string())
        .ok_or_else(|| RowError {
            row: row_num,
            reason: format!("column {col} ({field}) not found"),
        })
}

fn parse_xlsx_row(
    row: &[calamine::Data],
    params: &ImportParams,
    row_num: usize,
) -> Result<ParsedRow, RowError> {
    let label = get_xlsx_col(row, params.label_col, row_num, "label")?;
    let amount_str = get_xlsx_col(row, params.amount_col, row_num, "amount")?;

    let amount = parse_amount(&amount_str, row_num)?;
    let date = parse_xlsx_date(row, params.date_col, &params.date_format, row_num)?;

    Ok(ParsedRow {
        label,
        amount,
        date,
        row: row_num,
    })
}

/// Extract a date from an XLSX cell, handling Excel serial numbers natively.
fn parse_xlsx_date(
    row: &[calamine::Data],
    col: usize,
    format: &str,
    row_num: usize,
) -> Result<NaiveDate, RowError> {
    use calamine::Data;

    let cell = row.get(col).ok_or_else(|| RowError {
        row: row_num,
        reason: format!("column {col} (date) not found"),
    })?;

    // If calamine recognized it as a DateTime, use as_date() directly.
    if let Data::DateTime(excel_dt) = cell {
        return excel_dt
            .as_datetime()
            .map(|dt| dt.date())
            .ok_or_else(|| RowError {
                row: row_num,
                reason: format!("could not convert Excel datetime at column {col}"),
            });
    }

    // For Float/Int cells (Excel serial number stored as numeric), convert manually.
    if let Some(serial) = match cell {
        Data::Float(f) => Some(*f),
        Data::Int(i) => Some(*i as f64),
        _ => None,
    } {
        return excel_serial_to_date(serial, row_num);
    }

    // Fall back to string-based parsing (e.g. DateTimeIso or String cells).
    let s = cell.to_string();
    parse_date(&s, format, row_num)
}

fn get_xlsx_col(
    row: &[calamine::Data],
    col: usize,
    row_num: usize,
    field: &str,
) -> Result<String, RowError> {
    row.get(col).map(|c| c.to_string()).ok_or_else(|| RowError {
        row: row_num,
        reason: format!("column {col} ({field}) not found"),
    })
}

fn parse_amount(s: &str, row_num: usize) -> Result<Decimal, RowError> {
    // Normalise: remove spaces, replace comma decimal separator
    let normalised = s.replace(' ', "").replace(',', ".");
    Decimal::from_str(&normalised).map_err(|_| RowError {
        row: row_num,
        reason: format!("invalid amount: '{s}'"),
    })
}

fn parse_date(s: &str, format: &str, row_num: usize) -> Result<NaiveDate, RowError> {
    let trimmed = s.trim();

    // Try the user-specified format first.
    if let Ok(date) = NaiveDate::parse_from_str(trimmed, format) {
        return Ok(date);
    }

    // Fall back: if the string is a positive number, treat it as an Excel serial number.
    if let Ok(serial) = trimmed.parse::<f64>()
        && serial > 0.0
    {
        return excel_serial_to_date(serial, row_num);
    }

    Err(RowError {
        row: row_num,
        reason: format!("invalid date '{s}' for format '{format}'"),
    })
}

/// Convert an Excel serial date number to a `NaiveDate`.
///
/// Excel uses day 1 = 1900-01-01, but incorrectly treats 1900 as a leap year
/// (the Lotus 1-2-3 bug). Serial 60 = 1900-02-29 (which doesn't exist), so
/// for serials >= 61 we use a different epoch to compensate.
fn excel_serial_to_date(serial: f64, row_num: usize) -> Result<NaiveDate, RowError> {
    let days = serial as i64;
    let date = if days >= 61 {
        // For serials after the fake Feb 29: epoch 1899-12-30 + serial days
        let epoch = NaiveDate::from_ymd_opt(1899, 12, 30).unwrap();
        epoch + chrono::Duration::days(days)
    } else if days >= 1 {
        // For serials 1..=59: epoch 1899-12-31 + serial days
        let epoch = NaiveDate::from_ymd_opt(1899, 12, 31).unwrap();
        epoch + chrono::Duration::days(days)
    } else {
        return Err(RowError {
            row: row_num,
            reason: format!("Excel serial {serial} out of range"),
        });
    };
    // Sanity check: serial must produce a valid date in a reasonable range.
    if date.year() < 1900 || date.year() > 2200 {
        return Err(RowError {
            row: row_num,
            reason: format!("Excel serial {serial} out of range"),
        });
    }
    Ok(date)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_params() -> ImportParams {
        ImportParams {
            label_col: 0,
            amount_col: 1,
            date_col: 2,
            date_format: "%d/%m/%Y".to_string(),
            skip_lines: 1, // skip header row
            csv_delimiter: CsvDelimiter::Comma,
        }
    }

    #[test]
    fn parse_csv_basic() {
        let csv = b"label,amount,date\nSalaire,1500.00,31/01/2024\nLoyer,-800,05/02/2024\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 2);
        assert!(result.errors.is_empty());
        assert_eq!(result.rows[0].label, "Salaire");
        assert_eq!(result.rows[0].amount, Decimal::new(150000, 2));
    }

    #[test]
    fn parse_csv_bad_amount_reports_error() {
        let csv = b"label,amount,date\nTest,notanumber,01/01/2024\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 0);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].row, 2);
    }

    #[test]
    fn parse_csv_comma_decimal() {
        let csv = b"label,amount,date\nTest,\"1 200,50\",01/01/2024\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].amount, Decimal::new(120050, 2));
    }

    #[test]
    fn parse_csv_partial_errors() {
        let csv = b"label,amount,date\nGood,100.00,01/01/2024\nBad,notnum,01/01/2024\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.errors.len(), 1);
    }

    #[test]
    fn parse_csv_bad_date_reports_error() {
        let csv = b"label,amount,date\nTest,100.00,not-a-date\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 0);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].reason.contains("invalid date"));
    }

    #[test]
    fn parse_csv_custom_date_format() {
        let params = ImportParams {
            date_format: "%Y-%m-%d".to_string(),
            ..default_params()
        };
        let csv = b"label,amount,date\nTest,50.00,2024-03-15\n";
        let result = parse_csv(csv, &params);
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].date.to_string(), "2024-03-15");
    }

    #[test]
    fn parse_csv_date_with_time_keeps_the_day() {
        for (date_format, value) in [
            ("%d/%m/%Y %H:%M:%S", "15/03/2024 23:59:59"),
            ("%d/%m/%Y %H:%M", "15/03/2024 08:05"),
            ("%Y-%m-%d %H:%M:%S", "2024-03-15 00:00:00"),
            ("%Y-%m-%d %H:%M", "2024-03-15 12:30"),
            ("%Y-%m-%dT%H:%M:%S", "2024-03-15T12:30:00"),
        ] {
            let params = ImportParams {
                date_format: date_format.to_string(),
                ..default_params()
            };
            let csv = format!("label,amount,date\nTest,50.00,{value}\n");
            let result = parse_csv(csv.as_bytes(), &params);
            assert!(
                result.errors.is_empty(),
                "{date_format}: {:?}",
                result.errors
            );
            assert_eq!(result.rows[0].date.to_string(), "2024-03-15");
        }
    }

    #[test]
    fn parse_csv_only_header_returns_empty() {
        let csv = b"label,amount,date\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 0);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn parse_csv_missing_column_reports_error() {
        // Only 2 columns but date_col=2 expected
        let csv = b"label,amount\nTest,100.00\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 0);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].reason.contains("date"));
    }

    #[test]
    fn parse_csv_negative_amount() {
        let csv = b"label,amount,date\nLoyer,-800.00,01/01/2024\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 1);
        assert!(result.rows[0].amount.is_sign_negative());
    }

    #[test]
    fn parse_csv_whitespace_trimmed_from_labels() {
        let csv = b"label,amount,date\n  Salaire  ,100.00,01/01/2024\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].label, "Salaire");
    }

    #[test]
    fn parse_csv_different_column_order() {
        let params = ImportParams {
            label_col: 2,
            amount_col: 0,
            date_col: 1,
            date_format: "%d/%m/%Y".to_string(),
            skip_lines: 0,
            csv_delimiter: CsvDelimiter::Comma,
        };
        let csv = b"amount,date,label\n100.00,15/06/2024,Salaire\n";
        let result = parse_csv(csv, &params);
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].label, "Salaire");
        assert_eq!(result.rows[0].amount, Decimal::new(100, 0));
    }

    #[test]
    fn preview_csv_keeps_header_and_stops_at_limit() {
        let data = b"Date,Label,Amount\n01/01/2024, Coffee ,-3.50\n02/01/2024,Rent,-800\n";
        let rows = preview_rows(data, false, CsvDelimiter::Comma, 2).unwrap();
        assert_eq!(
            rows,
            vec![
                vec!["Date", "Label", "Amount"],
                vec!["01/01/2024", "Coffee", "-3.50"],
            ]
        );
    }

    #[test]
    fn preview_csv_keeps_ragged_rows() {
        let rows = preview_rows(
            b"Account statement\na,b,c\n",
            false,
            CsvDelimiter::Comma,
            10,
        )
        .unwrap();
        assert_eq!(rows, vec![vec!["Account statement"], vec!["a", "b", "c"]]);
    }

    #[test]
    fn preview_csv_splits_on_the_given_delimiter() {
        let rows = preview_rows(b"a;b,c;d\n", false, CsvDelimiter::Semicolon, 10).unwrap();
        assert_eq!(rows, vec![vec!["a", "b,c", "d"]]);
    }

    #[test]
    fn parse_csv_with_semicolon_delimiter_keeps_comma_decimals() {
        let params = ImportParams {
            csv_delimiter: CsvDelimiter::Semicolon,
            ..default_params()
        };
        let csv = b"label;amount;date\nCourses;-42,50;01/01/2024\n";
        let result = parse_csv(csv, &params);
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.rows[0].amount, Decimal::new(-4250, 2));
    }

    #[test]
    fn parse_csv_with_tab_delimiter() {
        let params = ImportParams {
            csv_delimiter: CsvDelimiter::Tab,
            ..default_params()
        };
        let csv = b"label\tamount\tdate\nLoyer\t-800\t05/02/2024\n";
        let result = parse_csv(csv, &params);
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.rows[0].label, "Loyer");
    }

    #[test]
    fn preview_invalid_spreadsheet_is_an_error() {
        assert!(preview_rows(b"not a workbook", true, CsvDelimiter::Comma, 10).is_err());
    }

    #[test]
    fn spreadsheet_is_detected_by_extension() {
        assert!(is_spreadsheet("releve.xlsx"));
        assert!(is_spreadsheet("releve.xls"));
        assert!(!is_spreadsheet("releve.csv"));
    }

    #[test]
    fn skip_leading_lines_skips_correct_number() {
        let data = b"ignored line 1\nignored line 2\nheader\ndata\n";
        let result = skip_leading_lines(data, 2);
        assert_eq!(result, b"header\ndata\n");
    }

    #[test]
    fn skip_leading_lines_zero_returns_all() {
        let data = b"header\ndata\n";
        let result = skip_leading_lines(data, 0);
        assert_eq!(result, data);
    }

    #[test]
    fn skip_leading_lines_more_than_available_returns_empty() {
        let data = b"only one line\n";
        let result = skip_leading_lines(data, 5);
        assert!(result.is_empty());
    }

    #[test]
    fn parse_csv_with_skip_lines() {
        let csv = b"Bank export v2\nGenerated 2024-01-01\nlabel,amount,date\nSalaire,1500.00,31/01/2024\n";
        let params = ImportParams {
            skip_lines: 3, // 2 junk lines + 1 header
            ..default_params()
        };
        let result = parse_csv(csv, &params);
        assert_eq!(result.rows.len(), 1);
        assert!(result.errors.is_empty());
        assert_eq!(result.rows[0].label, "Salaire");
    }

    #[test]
    fn parse_csv_with_skip_lines_error_row_numbers_are_correct() {
        let csv = b"junk\nlabel,amount,date\nTest,notanumber,01/01/2024\n";
        let params = ImportParams {
            skip_lines: 2, // 1 junk + 1 header
            ..default_params()
        };
        let result = parse_csv(csv, &params);
        assert_eq!(result.errors.len(), 1);
        // Row 3 in the original file: 2 skipped + 1 data row
        assert_eq!(result.errors[0].row, 3);
    }

    #[test]
    fn excel_serial_to_date_known_values() {
        // 1 = 1900-01-01
        let date = excel_serial_to_date(1.0, 1).unwrap();
        assert_eq!(date, NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());

        // 44197 = 2021-01-01
        let date = excel_serial_to_date(44197.0, 1).unwrap();
        assert_eq!(date, NaiveDate::from_ymd_opt(2021, 1, 1).unwrap());

        // 45712 = 2025-02-24
        let date = excel_serial_to_date(45712.0, 1).unwrap();
        assert_eq!(date, NaiveDate::from_ymd_opt(2025, 2, 24).unwrap());
    }

    #[test]
    fn parse_date_falls_back_to_excel_serial() {
        let date = parse_date("45712", "%d/%m/%Y", 1).unwrap();
        assert_eq!(date, NaiveDate::from_ymd_opt(2025, 2, 24).unwrap());
    }

    #[test]
    fn parse_csv_with_excel_serial_dates() {
        let csv = b"label,amount,date\nSalaire,1500.00,45712\n";
        let result = parse_csv(csv, &default_params());
        assert_eq!(result.rows.len(), 1);
        assert!(result.errors.is_empty());
        assert_eq!(
            result.rows[0].date,
            NaiveDate::from_ymd_opt(2025, 2, 24).unwrap()
        );
    }
}
