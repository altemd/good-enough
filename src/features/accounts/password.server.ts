import "@tanstack/react-start/server-only";

import {
	scrypt as nodeScrypt,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const PASSWORD_MIN_CODE_POINTS = 15;
const PASSWORD_MAX_CODE_POINTS = 128;

export function isValidPassword(password: string): boolean {
	const length = Array.from(password).length;
	return (
		length >= PASSWORD_MIN_CODE_POINTS && length <= PASSWORD_MAX_CODE_POINTS
	);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const digest = await derivePassword(password, salt, SCRYPT_KEY_LENGTH);
	return [
		"scrypt",
		"1",
		String(SCRYPT_N),
		String(SCRYPT_R),
		String(SCRYPT_P),
		salt.toString("base64url"),
		digest.toString("base64url"),
	].join("$");
}

export async function verifyPassword(
	encoded: string,
	password: string,
): Promise<boolean> {
	const [algorithm, version, n, r, p, saltValue, digestValue, extra] =
		encoded.split("$");
	if (
		algorithm !== "scrypt" ||
		version !== "1" ||
		n !== String(SCRYPT_N) ||
		r !== String(SCRYPT_R) ||
		p !== String(SCRYPT_P) ||
		!saltValue ||
		!digestValue ||
		extra !== undefined
	) {
		return false;
	}

	try {
		const expected = Buffer.from(digestValue, "base64url");
		const actual = await derivePassword(
			password,
			Buffer.from(saltValue, "base64url"),
			expected.length,
		);
		return (
			expected.length === SCRYPT_KEY_LENGTH && timingSafeEqual(expected, actual)
		);
	} catch {
		return false;
	}
}

function derivePassword(
	password: string,
	salt: Buffer,
	keyLength: number,
): Promise<Buffer> {
	return scrypt(password, salt, keyLength, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
		maxmem: SCRYPT_MAX_MEMORY,
	});
}

function scrypt(
	password: string,
	salt: Buffer,
	keyLength: number,
	options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(derivedKey);
		});
	});
}
