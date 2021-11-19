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
      if (cleanLine.startsWith('#')) {
        return acc;
      } else if (cleanLine.startsWith('[') && cleanLine.endsWith(']')) {
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

export async function fetchProfiles() {
  let profiles = {};
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    profiles = await fetchProfilesFromFile(CONFIG_FILE_PATH, profiles);
  }
  if (fs.existsSync(CREDENTIALS_FILE_PATH)) {
    profiles = await fetchProfilesFromFile(CREDENTIALS_FILE_PATH, profiles);
  }

  return profiles;
}
