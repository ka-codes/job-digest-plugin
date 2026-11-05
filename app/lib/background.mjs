// Drafts the profile.md "Background" summary from the uploaded CV's already-
// extracted text — shared by the setup wizard's own request and by the
// ongoing CV & Cover Letters page, so uploading/replacing a CV after setup
// keeps Background in sync too, not just the first time through the wizard.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getReferenceDocuments } from './profile-md.mjs';
import { runClaudeHeadless } from './claude.mjs';

export async function generateBackground(workspaceDir) {
  const { cvFiles } = getReferenceDocuments(workspaceDir);
  if (!cvFiles.length) return { background: '', note: 'No CV on file yet.' };

  const cvText = cvFiles
    .map((name) => {
      try {
        return readFileSync(join(workspaceDir, `${name}.txt`), 'utf8');
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!cvText) return { background: '', note: "Couldn't read the uploaded CV's text yet." };

  const prompt = `Here is the user's CV text:\n\n${cvText}\n\nWrite a 2-3 sentence professional background summary covering years of experience, key sectors, current role, and the most relevant prior roles. Plain prose, no bullet points, no heading, no preamble like "Here is a summary" — reply with only the summary text itself, nothing else.`;
  const output = await runClaudeHeadless(workspaceDir, prompt);
  return { background: output.trim() };
}
