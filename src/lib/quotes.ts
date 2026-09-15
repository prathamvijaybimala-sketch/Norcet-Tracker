/**
 * Daily quote bank for the greeting box.
 *
 * One quote per day, seeded off the day-of-year, so the same quote shows for
 * the whole day (and re-opening the app does not shuffle it).
 *
 * // TODO: revisit daily-seed vs per-open random - the daily seed is the
 * current behaviour; a per-open random pick (stable within one open session)
 * would also be reasonable if the quotes ever feel stale.
 *
 * Sourcing: the first twelve were the app's original set; the rest come from
 * short nursing-student motivational quotes collected online (mostly
 * unattributed, hence "Unknown"). Swap freely - this file is the only place
 * the list lives.
 */

export type StudyQuote = { text: string; author: string };

export const STUDY_QUOTES: StudyQuote[] = [
  { text: 'Every late-night study session is an investment in the lives you’ll save tomorrow.', author: 'Unknown' },
  { text: 'You’re not just studying — you’re preparing to save lives.', author: 'Unknown' },
  { text: 'Nursing school is temporary, but the lives you’ll impact as a nurse are forever.', author: 'Unknown' },
  { text: 'One more page. One more lesson. You are built for this.', author: 'Unknown' },
  { text: 'Your hard work will speak for you. Breathe. You got this.', author: 'Unknown' },
  { text: 'Impossible is just a challenge that hasn’t met your preparation yet.', author: 'Unknown' },
  { text: 'Every seasoned nurse was once exactly where you are. You belong here.', author: 'Unknown' },
  { text: 'Focus on progress, not perfection.', author: 'Unknown' },
  { text: 'Keep showing up. Your white coat moment is coming.', author: 'Unknown' },
  { text: 'What you do today matters forever.', author: 'Unknown' },
  { text: 'The difficult chapters are the ones that make you the calm one later.', author: 'Unknown' },
  { text: 'You didn’t choose nursing; nursing chose you. Trust the calling.', author: 'Unknown' },
  { text: 'Courage grows with practice.', author: 'Unknown' },
  { text: 'You are becoming the nurse someone will need.', author: 'Unknown' },
  { text: 'Rise. Study. Heal.', author: 'Unknown' },
  { text: 'Keep steady. Keep going.', author: 'Unknown' },
  { text: 'Your dreams are worth the work.', author: 'Unknown' },
  { text: 'You are stronger than every hard day.', author: 'Unknown' },
  { text: 'Never forget why you started.', author: 'Unknown' },
  { text: 'You remember more than you think you do.', author: 'Unknown' },
  { text: 'Small hours, steady days, one exam at a time.', author: 'Unknown' },
  { text: 'Trust the process - you’re closer than it feels.', author: 'Unknown' },
];
