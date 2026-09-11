/** Static question banks for Practice Mode. 'role' questions are generated from the JD. */

export type PracticeSetId =
  'behavioral' | 'role' | 'product' | 'coding' | 'system_design' | 'web' | 'puzzle';

export interface BankQuestion {
  question: string;
  category: string;
}

export const BEHAVIORAL_QUESTIONS: string[] = [
  'Tell me about yourself.',
  'Why do you want to work here?',
  'Walk me through your résumé.',
  'What is your greatest strength?',
  'What is your greatest weakness?',
  'Tell me about a time you had a conflict with a coworker and how you handled it.',
  'Describe a time you failed. What did you learn?',
  'Tell me about a project you are most proud of.',
  'Describe a situation where you had to work under a tight deadline.',
  'Tell me about a time you disagreed with your manager.',
  'How do you prioritise when everything is urgent?',
  'Give me an example of a time you showed leadership.',
  'Tell me about a time you had to learn something new quickly.',
  'Describe a time you received difficult feedback. How did you respond?',
  'Tell me about a time you went above and beyond for a customer or user.',
  'How do you handle ambiguity or unclear requirements?',
  'Tell me about a time you had to persuade someone to see things your way.',
  'Describe a mistake you made at work and how you fixed it.',
  'Tell me about a time you had to deliver bad news.',
  'How do you deal with a teammate who is not pulling their weight?',
  'Tell me about a time you improved a process.',
  'What motivates you?',
  'Where do you see yourself in five years?',
  'Why are you leaving your current role?',
  'Do you have any questions for us?',
];

export const CODING_QUESTIONS: string[] = [
  'How would you find the first non-repeating character in a string? Talk through the approach and complexity.',
  'Explain how you would detect a cycle in a linked list.',
  'Given an array of integers, how would you find two numbers that add up to a target? What is the optimal complexity?',
  'How would you reverse the words in a sentence in place?',
  'Describe how you would merge two sorted arrays and the edge cases you would test.',
  'How would you check whether a binary tree is balanced?',
  'Explain the difference between BFS and DFS and when you would use each.',
  'How would you implement an LRU cache? What data structures would you use?',
  'Talk me through finding the k most frequent elements in a list.',
  'How would you validate that a string of brackets is balanced?',
  'Explain how binary search works and a bug people commonly introduce when implementing it.',
  'How would you find the longest substring without repeating characters?',
  'Describe an approach to compute the top N trending hashtags from a stream of tweets.',
  'How would you serialise and deserialise a binary tree?',
  'Given a matrix of 0s and 1s, how would you count the number of islands?',
];

export const WEB_QUESTIONS: string[] = [
  'What is the difference between HTML, CSS and JavaScript? Explain it to someone non-technical.',
  'What does the DOM mean and why does it matter?',
  'What is the difference between an id and a class in HTML and CSS?',
  'What is the CSS box model?',
  'What is the difference between display: block, inline and inline-block?',
  'How does CSS specificity decide which style wins?',
  'What is the difference between position: relative, absolute and fixed?',
  'When would you use Flexbox versus CSS Grid?',
  'What is a media query and how do you make a page responsive?',
  'What is the difference between let, const and var in JavaScript?',
  'What is the difference between == and === in JavaScript?',
  'What is an event listener? Give an example of using one.',
  'What is the difference between synchronous and asynchronous code, and what is a Promise?',
  'What is async/await and how does it relate to Promises?',
  'What is a callback function?',
  'What does the "this" keyword refer to in JavaScript?',
  'What is JSON and how do you parse it in JavaScript?',
  'What is the difference between localStorage, sessionStorage and cookies?',
  'What is an API and how would you call one from a web page?',
  'How would you debug a button that does nothing when clicked?',
  'What happens when you type a URL into the browser and press Enter?',
  'What is a CSS variable and when would you use one?',
  'What is semantic HTML and why does it matter for accessibility?',
  'What is the difference between a script tag with defer and one with async?',
  'How would you add a small piece of custom JavaScript to a Shopify theme safely?',
];

export const PUZZLE_QUESTIONS: string[] = [
  'You have three light switches downstairs and one bulb upstairs. You can go upstairs once. How do you find which switch controls the bulb?',
  'How many golf balls fit in a school bus? Walk me through your estimate.',
  'A bat and a ball cost $1.10 in total. The bat costs $1 more than the ball. How much is the ball?',
  'If it takes 5 machines 5 minutes to make 5 widgets, how long would 100 machines take to make 100 widgets?',
  'You have two ropes that each take exactly one hour to burn, but they burn unevenly. How do you measure 45 minutes?',
  'How would you weigh an elephant without a scale?',
  'You have 8 balls; one is slightly heavier. Using a balance scale only twice, how do you find it?',
  'How many times a day do the hands of a clock overlap?',
  'A lily pad doubles in size every day and covers the pond on day 30. On which day does it cover half the pond?',
  'How many piano tuners are there in Chicago? Estimate it.',
  'Two trains 100 km apart head toward each other at 50 km/h each. A bird flies between them at 100 km/h until they meet. How far does the bird fly?',
  'You are in a room with two doors, one guard each; one always lies, one always tells the truth. You can ask one question. What do you ask?',
  'What is the angle between the hands of a clock at 3:15?',
  'How would you move Mount Fuji?',
  'Why are manhole covers round?',
];

export const SYSTEM_DESIGN_QUESTIONS: string[] = [
  'Design a URL shortener. Walk me through the API, storage and how you would scale reads.',
  'How would you design a rate limiter for a public API?',
  'Design a news feed for a social network. How do you rank and cache it?',
  'How would you design a chat application that supports group messages and read receipts?',
  'Design a file storage service like Dropbox. How do you handle sync and conflicts?',
  'How would you design a notification system that sends email, SMS and push?',
  'Design a metrics and monitoring pipeline for thousands of services.',
  'How would you design a distributed job scheduler with retries and exactly-once semantics?',
  'Design a search autocomplete system. Where does latency come from and how do you cut it?',
  'How would you design a payment system that must never double-charge a customer?',
  'Design a ride-sharing dispatch system. How do you match riders and drivers in real time?',
  'How would you migrate a monolith to services without downtime?',
];

export const STATIC_BANKS: Record<
  Exclude<PracticeSetId, 'role' | 'product'>,
  { label: string; description: string; category: string; questions: string[] }
> = {
  behavioral: {
    label: 'Common behavioral',
    description: 'Tell-me-about-a-time classics: strengths, conflict, failure, leadership.',
    category: 'behavioral',
    questions: BEHAVIORAL_QUESTIONS,
  },
  coding: {
    label: 'Coding (verbal)',
    description: 'Talk through algorithms, data structures and complexity out loud.',
    category: 'coding',
    questions: CODING_QUESTIONS,
  },
  system_design: {
    label: 'System design',
    description: 'Architecture, scaling and trade-off questions.',
    category: 'system_design',
    questions: SYSTEM_DESIGN_QUESTIONS,
  },
  web: {
    label: 'Web fundamentals (HTML, CSS, JavaScript)',
    description:
      'Plain-language questions on HTML, CSS and JavaScript basics, as asked in support and junior developer screens.',
    category: 'web',
    questions: WEB_QUESTIONS,
  },
  puzzle: {
    label: 'Puzzles & brain teasers',
    description: 'Logic, estimation and lateral-thinking questions — practise reasoning out loud.',
    category: 'puzzle',
    questions: PUZZLE_QUESTIONS,
  },
};

/** Deterministic-ish shuffle (Fisher–Yates) with an optional seed for tests. */
export function shuffle<T>(items: T[], seed?: number): T[] {
  const out = items.slice();
  let s = seed ?? Math.floor(Math.random() * 1_000_000);
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function pickStatic(
  setId: Exclude<PracticeSetId, 'role' | 'product'>,
  count: number,
  seed?: number,
): BankQuestion[] {
  const bank = STATIC_BANKS[setId];
  // "Tell me about yourself" is a natural opener; keep it first when present.
  const opener = bank.questions[0];
  const rest = shuffle(bank.questions.slice(1), seed);
  const chosen =
    setId === 'behavioral' && opener ? [opener, ...rest] : shuffle(bank.questions, seed);
  return chosen
    .slice(0, Math.max(1, count))
    .map((question) => ({ question, category: bank.category }));
}
