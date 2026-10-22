import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { EnvsyncError } from './errors.js';

export async function generateAgeKey(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

/**
 * 개인키에서 공개키(recipient)를 유도한다. 앞뒤 공백·줄바꿈은 무시한다.
 * 라이브러리 오류 메시지에는 키 일부가 들어갈 수 있어 고정된 메시지로 바꾼다.
 */
export async function recipientOf(identity: string): Promise<string> {
  try {
    return await identityToRecipient(identity.trim());
  } catch {
    throw new EnvsyncError(
      'BW_ERROR',
      'Bitwarden에 저장된 age 개인키 형식이 올바르지 않습니다.',
      'age 키 항목(envsync:<owner>/<repo>:age-key)의 내용이 AGE-SECRET-KEY-1로 시작하는 한 줄인지 확인하세요.',
    );
  }
}
