import os from 'os';
import fs from 'fs';
import util from 'util';

const CONFIG_FILE_PATH = `${os.homedir()}/.aws/config`;
const CREDENTIALS_FILE_PATH = `${os.homedir()}/.aws/credentials`;

async function fetchProfilesFromFile(file, profiles) {
  const readFile = util.promisify(fs.readFile);
  const body = await readFile(file, 'utf8');
  const initial = {currentProfile: '', profiles};
  const final = body.split('\n')
    .reduce((acc, line) => {
      const cleanLine = line.trim();
      if (cleanLine.startsWith('[') && cleanLine.endsWith(']')) {
        const key = cleanLine.substring(1, cleanLine.length - 1);
        if (key.startsWith('profile ')) {
          acc.currentProfile = key.substr(8);
        } else {
          acc.currentProfile = key;
        }
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
}

const ALLOWED_KEYS = new Set(['aws_access_key_id', 'aws_secret_access_key', 'role_arn', 'source_profile', 'mfa_serial', 'external_id']);

function valiateProfiles(profiles) {
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
}

export async function fetchProfiles() {
  let profiles = {};
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    profiles = await fetchProfilesFromFile(CONFIG_FILE_PATH, profiles);
  }
  if (fs.existsSync(CREDENTIALS_FILE_PATH)) {
    profiles = await fetchProfilesFromFile(CREDENTIALS_FILE_PATH, profiles);
  }

  return valiateProfiles(profiles);
}
