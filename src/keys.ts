import { generateIdentity, identityToRecipient } from 'age-encryption';

export async function generateAgeKey(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateIdentity();
  return { identity, recipient: await identityToRecipient(identity) };
}

export async function recipientOf(identity: string): Promise<string> {
  return identityToRecipient(identity);
}
