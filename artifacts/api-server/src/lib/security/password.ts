import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
const KEY_LENGTH = 64;
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const PARAMS_LABEL = `N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}`;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, PARAMS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 14) return "Пароль должен содержать не менее 14 символов";
  if (password.length > 1024) return "Пароль слишком длинный";
  if (!/[A-Za-zА-Яа-яЁё]/u.test(password) || !/\d/u.test(password)) {
    return "Пароль должен содержать буквы и цифры";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new Error(policyError);
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return [ALGORITHM, PARAMS_LABEL, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, params, saltEncoded, keyEncoded, extra] = encoded.split("$");
  if (
    algorithm !== ALGORITHM ||
    params !== PARAMS_LABEL ||
    !saltEncoded ||
    !keyEncoded ||
    extra !== undefined
  ) return false;

  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(keyEncoded, "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await deriveKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
