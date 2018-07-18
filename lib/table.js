'use strict';

const stringCell = (cell) => {
  if (cell === undefined || cell === null) {
    return '';
  }
  return cell.toString();
};

const optimizeColSize = (colLabel, cells) => {
  const size = Math.max(5, colLabel.length);
  return cells.reduce((acc, cell) => {
    const str = stringCell(cell);
    return Math.max(str.length, acc);
  }, size);
};

const saveCell = (cell, size) => {
  const str = stringCell(cell);
  if (str.length > size) {
    return `${str.substr(0, size-3)}${'.'.repeat(3)}`;
  }
  return stringCell(cell).padEnd(size);
};

const create = (cols, rows) => {
  const lineCharacter = '-';
  const colCharacter = '|';
  const internalCols = cols.map((colLabel, i) => {
    const optimizedSize = optimizeColSize(colLabel, rows.map(row => row[i]));
    return {
      label: colLabel,
      optimizedSize,
      size: (stdcolumns) => {
        console.log('stdcolumns', stdcolumns);
        const availableCols = stdcolumns - 2 - (cols.length-1)*3 - 2;
        if (usedCols > availableCols) { // scale down
          return Math.floor(optimizedSize * availableCols / usedCols);
        } else if (usedCols < (availableCols*0.8)) { // scale up
          return Math.floor(optimizedSize * (availableCols*0.8) / usedCols);
        }
        return optimizedSize;
      }
    };
  });
  const usedCols = internalCols.reduce((acc, internalCol) => acc + internalCol.optimizedSize, 0);
  const printLine = (stdconsole, stdcolumns) => {
    const colsSize = internalCols.reduce((acc, internalCol) => acc + internalCol.size(stdcolumns), 0);
    stdconsole.info(`${lineCharacter.repeat(2)}${lineCharacter.repeat(colsSize + (cols.length-1) * 3)}${lineCharacter.repeat(2)}`);
  };
  const printData = (stdconsole, stdcolumns, data) => {
    stdconsole.info(`${colCharacter} ${data.map((cell, i) => saveCell(cell, internalCols[i].size(stdcolumns))).join(` ${colCharacter} `)} ${colCharacter}`);
  };
  const printHeader = (stdconsole, stdcolumns) => {
    printLine(stdconsole, stdcolumns);
    printData(stdconsole, stdcolumns, internalCols.map(internalCol => internalCol.label));
    printLine(stdconsole, stdcolumns);
  };
  const printBodyRow = printData;
  const printBody = (stdconsole, stdcolumns) => {
    rows.forEach(row => printBodyRow(stdconsole, stdcolumns, row));
  };
  const printFooter = printLine;

  return {
    printHeader,
    printBodyRow,
    printBody,
    printFooter,
    print: (stdconsole = console, stdcolumns = process.stdout.columns) => {
      printHeader(stdconsole, stdcolumns);
      printBody(stdconsole, stdcolumns);
      printFooter(stdconsole, stdcolumns);
    }
  };
};

module.exports.create = create;

module.exports.print = (stdconsole, stdcolumns, cols, rows) => {
  const table = create(cols, rows);
  table.print(stdconsole, stdcolumns);
};
