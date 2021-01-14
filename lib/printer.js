'use strict';
// @ts-check
// ==================================================================================
// printers.js
// ----------------------------------------------------------------------------------
// Description:   System Information - library
//                for Node.js
// Copyright:     (c) 2014 - 2024
// Author:        Sebastian Hildebrandt
// ----------------------------------------------------------------------------------
// License:       MIT
// ==================================================================================
// 15. printers
// ----------------------------------------------------------------------------------

const os = require('os');
const exec = require('child_process').exec;
const util = require('./util');
const fs = require('fs');
const { execSync } = require('child_process');

let _platform = process.platform;

const _linux = (_platform === 'linux' || _platform === 'android');
const _darwin = (_platform === 'darwin');
const _windows = (_platform === 'win32');
const _freebsd = (_platform === 'freebsd');
const _openbsd = (_platform === 'openbsd');
const _netbsd = (_platform === 'netbsd');
const _sunos = (_platform === 'sunos');


const NOT_SUPPORTED = 'not supported';
const band = BigInt(0xffff, 16);
const shr1 = BigInt(16);
const shr2 = BigInt(32);
const shr3 = BigInt(48);
/* https://superuser.com/questions/1380807/retrieve-printer-driver-version-with-powershell-printmanagement-cmdlets */
function getVersion(bInt) {
  const mainVal = BigInt(bInt);
  const rev = (mainVal & band).toString(10);
  const build = ((mainVal >> shr1) & band).toString(10);
  const minor = ((mainVal >> shr2) & band).toString(10);
  const major = ((mainVal >> shr3) & band).toString(10);
  return `${major}.${minor}.${build}.${rev}`;
}

function printerDrivers (callback) {
  return new Promise((resolve, reject) => {
    process.nextTick(() => {
      if (!_windows) {
        if(callback) {callback(null, new Error(NOT_SUPPORTED))}
        return reject(new Error(NOT_SUPPORTED));
      }
      try {
        // const KeyMap = Object.keys(result);
        util.wmic(`/Namespace:\\\\root\\standardCimv2 path MSFT_PrinterDriver where "Manufacturer!='Microsoft'" get Name,Manufacturer,provider,DriverVersion,MajorVersion /format:csv`)
          .then( (stdout) => {
            const lines = stdout.toString().split(os.EOL);
            let header = [];
            const DriverArr = lines.reduce((acc, line) => {
              line = line.replace(/\s+/g, ' ').trim();
              if (line.length <= 1 ) {
                return acc;
              }
              if (header.length === 0) {
                header = line.split(',').map(n => n.trim());
                return acc;
              }
              const vals = line.split(',').map(n => n.trim());
              const driver = header.reduce((obj, head, idx) => {
                if(head !== 'Node') {
                  obj[head] = head === 'DriverVersion' ? getVersion(vals[idx]) : vals[idx];
                }
                return obj;
              }, {});
              acc.push(driver);
              return acc;
            }, []);
            resolve(DriverArr)
          })
      } catch (e) {
        console.error(e);
        reject(e);
      }
    })
  })
}

const winPrinterStatus = {
  1: 'Other',
  2: 'Unknown',
  3: 'Idle',
  4: 'Printing',
  5: 'Warmup',
  6: 'Stopped Printing',
  7: 'Offline',
};

function parseLinuxCupsHeader(lines) {
  const result = {};
  if (lines && lines.length) {
    if (lines[0].indexOf(' CUPS v') > 0) {
      const parts = lines[0].split(' CUPS v');
      result.cupsVersion = parts[1];
    }
  }
  return result;
}

function parseLinuxCupsPrinter(lines) {
  const result = {};
  const printerId = util.getValue(lines, 'PrinterId', ' ');
  result.id = printerId ? parseInt(printerId, 10) : null;
  result.name = util.getValue(lines, 'Info', ' ');
  result.model = lines.length > 0 && lines[0] ? lines[0].split(' ')[0] : '';
  result.uri = util.getValue(lines, 'DeviceURI', ' ');
  result.uuid = util.getValue(lines, 'UUID', ' ');
  result.status = util.getValue(lines, 'State', ' ');
  result.local = util.getValue(lines, 'Location', ' ').toLowerCase().startsWith('local');
  result.default = null;
  result.shared = util.getValue(lines, 'Shared', ' ').toLowerCase().startsWith('yes');

  return result;
}

function parseLinuxLpstatPrinter(lines, id) {
  const result = {};
  result.id = id;
  result.name = util.getValue(lines, 'Description', ':', true);
  result.model = lines.length > 0 && lines[0] ? lines[0].split(' ')[0] : '';
  result.uri = null;
  result.uuid = null;
  result.status = lines.length > 0 && lines[0] ? (lines[0].indexOf(' idle') > 0 ? 'idle' : (lines[0].indexOf(' printing') > 0 ? 'printing' : 'unknown')) : null;
  result.local = util.getValue(lines, 'Location', ':', true).toLowerCase().startsWith('local');
  result.default = null;
  result.shared = util.getValue(lines, 'Shared', ' ').toLowerCase().startsWith('yes');

  return result;
}

function parseDarwinPrinters(printerObject, id) {
  const result = {};
  const uriParts = printerObject.uri.split('/');
  result.id = id;
  result.name = printerObject._name;
  result.model = uriParts.length ? uriParts[uriParts.length - 1] : '';
  result.uri = printerObject.uri;
  result.uuid = null;
  result.status = printerObject.status;
  result.local = printerObject.printserver === 'local';
  result.default = printerObject.default === 'yes';
  result.shared = printerObject.shared === 'yes';

  return result;
}

function parseWindowsPrinters(lines, id) {
  const result = {};
  const status = parseInt(util.getValue(lines, 'PrinterStatus', ':'), 10);

  result.id = id;
  result.name = util.getValue(lines, 'name', ':');
  result.model = util.getValue(lines, 'DriverName', ':');
  result.uri = null;
  result.uuid = null;
  result.status = winPrinterStatus[status] ? winPrinterStatus[status] : null;
  result.local = util.getValue(lines, 'Local', ':').toUpperCase() === 'TRUE';
  result.default = util.getValue(lines, 'Default', ':').toUpperCase() === 'TRUE';
  result.shared = util.getValue(lines, 'Shared', ':').toUpperCase() === 'TRUE';

  return result;
}

function printer(callback) {

  return new Promise((resolve) => {
    process.nextTick(() => {
      let result = [];
      if (_linux || _freebsd || _openbsd || _netbsd) {
        let cmd = 'cat /etc/cups/printers.conf 2>/dev/null';
        exec(cmd, function (error, stdout) {
          // printers.conf
          if (!error) {
            const parts = stdout.toString().split('<Printer ');
            const printerHeader = parseLinuxCupsHeader(parts[0]);
            for (let i = 1; i < parts.length; i++) {
              const printers = parseLinuxCupsPrinter(parts[i].split('\n'));
              if (printers.name) {
                printers.engine = 'CUPS';
                printers.engineVersion = printerHeader.cupsVersion;
                result.push(printers);
              }
            }
          }
          if (result.length === 0) {
            if (_linux) {
              cmd = 'export LC_ALL=C; lpstat -lp 2>/dev/null; unset LC_ALL';
              // lpstat
              exec(cmd, function (error, stdout) {
                const parts = ('\n' + stdout.toString()).split('\nprinter ');
                for (let i = 1; i < parts.length; i++) {
                  const printers = parseLinuxLpstatPrinter(parts[i].split('\n'), i);
                  result.push(printers);
                }
              });
              if (callback) {
                callback(result);
              }
              resolve(result);
            } else {
              if (callback) {
                callback(result);
              }
              resolve(result);
            }
          } else {
            if (callback) {
              callback(result);
            }
            resolve(result);
          }
        });
      }
      if (_darwin) {
        let cmd = 'system_profiler SPPrintersDataType -json';
        exec(cmd, function (error, stdout) {
          if (!error) {
            try {
              const outObj = JSON.parse(stdout.toString());
              if (outObj.SPPrintersDataType && outObj.SPPrintersDataType.length) {
                for (let i = 0; i < outObj.SPPrintersDataType.length; i++) {
                  const printer = parseDarwinPrinters(outObj.SPPrintersDataType[i], i);
                  result.push(printer);
                }
              }
            } catch (e) {
              util.noop();
            }
          }
          if (callback) {
            callback(result);
          }
          resolve(result);
        });
      }
      if (_windows) {
        util.powerShell('Get-CimInstance Win32_Printer | select PrinterStatus,Name,DriverName,Local,Default,Shared | fl').then((stdout, error) => {
          if (!error) {
            const parts = stdout.toString().split(/\n\s*\n/);
            for (let i = 0; i < parts.length; i++) {
              const printer = parseWindowsPrinters(parts[i].split('\n'), i);
              if (printer.name || printer.model) {
                result.push(printer);
              }
            }
          }
          if (callback) {
            callback(result);
          }
          resolve(result);
        });
      }
      if (_sunos) {
        resolve(null);
      }
    });
  });
}

exports.printer = printer;

exports.printerDrivers = printerDrivers;
