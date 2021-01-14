'use strict';
// @ts-check
// ==================================================================================
// osinfo.js
// ----------------------------------------------------------------------------------
// Description:   System Information - library
//                for Node.js
// Copyright:     (c) 2014 - 2021
// Author:        Sebastian Hildebrandt
// ----------------------------------------------------------------------------------
// License:       MIT
// ==================================================================================
// 3. Operating System
// ----------------------------------------------------------------------------------

const os = require('os');
const exec = require('child_process').exec;
const util = require('./util');
const fs = require('fs');
const { execSync } = require('child_process');

let _platform = process.platform;

const _linux = (_platform === 'linux');
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

exports.printerDrivers = printerDrivers;
