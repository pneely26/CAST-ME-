// Generates public/samples/demo-agency-submissions.xlsx (DEMO DATA).
import ExcelJS from "exceljs";

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Submissions (DEMO DATA)");
  ws.addRow(["Date Submitted", "Project", "Role", "Casting Director", "Platform", "Region", "Union", "Status", "Notes"]);
  ws.addRow([new Date(Date.UTC(2026, 8, 23)), "Harbor Lights", "Nora Vance", "Lena Park", "Apple TV+", "New York", "SAG-AFTRA", "Callback", "DEMO DATA — fictional"]);
  ws.addRow([new Date(Date.UTC(2026, 8, 26)), "Untitled Amazon Thriller", "Agent Cole", "Rosa Grant", "Amazon MGM", "Los Angeles", "SAG-AFTRA", "Submitted", "DEMO DATA — fictional"]);
  ws.addRow([new Date(Date.UTC(2026, 8, 27)), "Last Summer", "Kim", "Tom Becker", "Hulu", "Los Angeles", "SAG-AFTRA", "Submitted", "DEMO DATA — fictional"]);
  await wb.xlsx.writeFile("public/samples/demo-agency-submissions.xlsx");
}
main();
