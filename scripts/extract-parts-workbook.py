"""Read the supplied workbook without changing it; retain every cell and cached result."""
import datetime
import hashlib
import json
import pathlib
import sys

import openpyxl


def extract(path):
    source = openpyxl.load_workbook(path, data_only=False)
    cached = openpyxl.load_workbook(path, data_only=True)
    book = {"schemaVersion": 1, "sourceFile": path.name,
            "sourceHash": hashlib.sha256(path.read_bytes()).hexdigest(), "sheets": []}
    for index, sheet in enumerate(source):
        rows = []
        for row in sheet:
            cells, formulas, types = [], {}, {}
            for cell in row:
                value = cached[sheet.title][cell.coordinate].value if cell.data_type == 'f' else cell.value
                col = str(cell.column - 1)
                if cell.data_type == 'f':
                    formulas[col] = cell.value
                if isinstance(value, (datetime.datetime, datetime.date)):
                    value = value.isoformat()[:10]
                    types[col] = 'date'
                cells.append(value)
            rows.append({"id": f"s{index}-r{row[0].row}", "cells": cells,
                         "formulas": formulas, "types": types})
        book['sheets'].append({"id": f"s{index}", "name": sheet.title,
            "originalRows": sheet.max_row, "originalColumns": sheet.max_column,
            "headerRows": 3 if index == 0 else 1,
            "columns": [{"id": f"s{index}-c{c}"} for c in range(sheet.max_column)],
            "merges": [{"r": m.min_row - 1, "c": m.min_col - 1,
                        "rows": m.max_row - m.min_row + 1, "cols": m.max_col - m.min_col + 1}
                       for m in sheet.merged_cells.ranges], "rows": rows})
    return book


if __name__ == '__main__':
    book = extract(pathlib.Path(sys.argv[1]))
    target = pathlib.Path(sys.argv[2])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(book, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({"sheets": [{"name": s['name'], "rows": len(s['rows']),
          "columns": len(s['columns'])} for s in book['sheets']], "bytes": target.stat().st_size}))
