'use strict';

const os = require('os');
const fs = require('fs');
const util = require('util');

const CREDENTIALS_FILE_PATH = `${os.homedir()}/.aws/credentials`;

const fetchProfiles = async () => {
  const readFile = util.promisify(fs.readFile);
  const body = await readFile(CREDENTIALS_FILE_PATH, 'utf8');
  const initial = {currentProfile: '', profiles: {}};
  const final = body.split('\n')
    .reduce((acc, line) => {
      const cleanLine = line.trim();
      if (cleanLine.startsWith('[') && cleanLine.endsWith(']')) {
        acc.currentProfile = cleanLine.substring(1, cleanLine.length - 1);
      } else if(cleanLine.includes('=')) {
        if (!(acc.currentProfile in acc.profiles)) {
          acc.profiles[acc.currentProfile] = {};
        }
        const [key, value] = cleanLine.split('=', 2);
        const cleanKey = key.trim();
        const cleanValue = value.trim();
        acc.profiles[acc.currentProfile][cleanKey] = cleanValue;
      }
      return acc;
    }, initial);
  return final.profiles;
};

const ALLOWED_KEYS = new Set(['aws_access_key_id', 'aws_secret_access_key', 'role_arn', 'source_profile', 'mfa_serial', 'external_id']);

const valiateProfiles = (profiles) => {
  const ret = {};
  const keys = Object.keys(profiles);
  keys.forEach(key => {
    const rawProfile = profiles[key];
    const cleanProfile = {};
    const keys = Object.keys(rawProfile);
    keys.forEach(key => {
      if (ALLOWED_KEYS.has(key)) {
        cleanProfile[key] = rawProfile[key];
      }
    });
    if (Object.keys(cleanProfile).length > 0) {
      ret[key] = cleanProfile;
    }
  });
  return ret;
};

module.exports.fetchProfiles = async () => {
  if (fs.existsSync(CREDENTIALS_FILE_PATH)) {
    const profiles = await fetchProfiles();
    return valiateProfiles(profiles);
  } else {
    throw Error(`file does not exist ${CREDENTIALS_FILE_PATH}`);
  }
};



