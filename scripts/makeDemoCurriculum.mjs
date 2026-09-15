/**
 * Generates public/demo-curriculum.json.
 *
 * The demo mirrors the real curriculum's shape and scale (~40 min average
 * lecture) and uses the exact per-subject hour totals quoted in the project
 * spec's section 8.2 sanity check, so the integration test and the in-app demo
 * exercise the same numbers.
 *
 * Run: npm run demo
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../public/demo-curriculum.json');

const SUBJECTS = [
  {
    name: 'Community Health Nursing',
    instructor: 'Dr Neha Sharma',
    hours: 49.6,
    topics: [
      'Introduction to Community Health',
      'Epidemiology',
      'Communicable Diseases',
      'National Health Programmes',
      'Family Welfare & RMNCH+A',
      'Environmental Health',
      'Health Education & Communication',
      'Nutrition Programmes',
      'Demography & Vital Statistics',
      'School & Occupational Health',
    ],
  },
  {
    name: 'Midwifery and Obstetrical Nursing',
    instructor: 'Dr Ritu Bansal',
    hours: 105.7,
    topics: [
      'Anatomy of the Female Pelvis',
      'Physiology of Pregnancy',
      'Antenatal Care',
      'Normal Labour & Delivery',
      'Complications of Labour',
      'Postnatal Care',
      'Newborn Care & Resuscitation',
      'High Risk Pregnancy',
      'Obstetric Procedures & Instruments',
      'Pharmacotherapeutics in Obstetrics',
      'Medico-Legal Aspects',
      'Recent Advances & MCQs',
    ],
  },
  {
    name: 'Child Health Nursing',
    instructor: 'Dr Amanpreet Kaur',
    hours: 42.1,
    topics: [
      'Growth and Development',
      'Newborn Assessment',
      'Nutrition in Children',
      'Immunisation Schedule',
      'Respiratory Disorders',
      'Gastrointestinal Disorders',
      'Cardiac Disorders',
      'Neurological Disorders',
      'Behavioural & Developmental Disorders',
      'Paediatric Emergencies',
    ],
  },
  {
    name: 'Medical Surgical Nursing (Surgery)',
    instructor: 'Dr Vikram Sethi',
    hours: 23.7,
    topics: [
      'Pre & Post Operative Care',
      'Wound Care & Dressings',
      'Anaesthesia & OT Techniques',
      'Gastrointestinal Surgery',
      'Urological Surgery',
      'Neurosurgical Nursing',
      'Orthopaedic & Trauma Nursing',
      'Oncological Surgery',
    ],
  },
  {
    name: 'Medical Surgical Nursing (Medicine)',
    instructor: 'Dr Shrikant Verma',
    hours: 82.0,
    topics: [
      'Fluid & Electrolyte Balance',
      'Cardiovascular Disorders',
      'Respiratory Disorders',
      'Endocrine & Metabolic Disorders',
      'Renal & Urinary Disorders',
      'Gastrointestinal & Hepatic Disorders',
      'Neurological Disorders',
      'Haematological Disorders',
      'Immunological & Connective Tissue Disorders',
      'Infectious Diseases',
      'Geriatric & Rehabilitative Nursing',
      'Emergency & Critical Care',
    ],
  },
  {
    name: 'Nursing Foundation',
    instructor: 'Dr Pooja Arora',
    hours: 160.3,
    topics: [
      'Nursing as a Profession',
      'Health, Illness & Wellness',
      'Hospital & Community Environment',
      'Admission, Transfer & Discharge',
      'Vital Signs & Assessment',
      'Hygiene, Comfort & Rest',
      'Nutrition & Elimination',
      'Medication Administration',
      'Infection Control & Biomedical Waste',
      'Bandaging, Splinting & Positioning',
      'Documentation & Records',
      'Communication & Nurse-Patient Relationship',
      'Nursing Process & Care Plans',
      'First Aid & Emergency Care',
      'Ethics, Legal Issues & Trends',
      'Computers & Nursing Informatics',
    ],
  },
  {
    name: 'Pharmacology',
    instructor: 'Dr Harpreet Singh',
    hours: 43.7,
    topics: [
      'General Pharmacology',
      'Autonomic Nervous System',
      'Central Nervous System Drugs',
      'Cardiovascular & Renal Drugs',
      'Respiratory Drugs',
      'Gastrointestinal Drugs',
      'Endocrine Drugs',
      'Chemotherapy & Antimicrobials',
      'Toxicology & Drug Calculations',
    ],
  },
  {
    name: 'Microbiology',
    instructor: 'Dr Sunita Rao',
    hours: 9.0,
    topics: [
      'Introduction & Microscopy',
      'Bacteriology',
      'Virology & Fungal Infections',
      'Immunity & Serology',
      'Sterilisation & Disinfection',
    ],
  },
];

/** Deterministic LCG so the demo file is reproducible. */
function rngFor(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const VARIANTS = [
  (n) => `Part ${n}`,
  (n) => `Part ${n} (Continued)`,
  (n) => `Part ${n} - Important Points`,
  (n) => `Part ${n} - MCQ Discussion`,
  (n) => `Part ${n} - Numerical & Quick Revision`,
];

const out = {};
let totalLectures = 0;
let totalSec = 0;

SUBJECTS.forEach((subject, subjectIndex) => {
  const total = Math.round(subject.hours * 3600);
  const rand = rngFor(1000 + subjectIndex * 7919);
  const count = Math.max(subject.topics.length * 2, Math.round(total / 2424));
  const base = total / count;

  const raw = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const jitter = 0.5 + rand() * 1.0; // 0.5x .. 1.5x of the average
    const sec = Math.max(300, Math.min(7200, Math.round(base * jitter)));
    raw.push(sec);
    sum += sec;
  }
  // Rescale so the subject total matches the quoted hours exactly (the random
  // jitter leaves a few percent of drift otherwise).
  const scale = total / sum;
  let scaledSum = 0;
  for (let i = 0; i < count; i++) {
    raw[i] = Math.max(300, Math.round(raw[i] * scale));
    scaledSum += raw[i];
  }
  let residual = total - scaledSum;
  for (let i = 0; residual !== 0 && i < count * 4; i++) {
    const idx = i % count;
    const step = residual > 0 ? 1 : -1;
    if (raw[idx] + step < 300) continue;
    raw[idx] += step;
    residual -= step;
  }

  // Spread lectures across topics, weighted by topic index (later topics get a
  // couple more, like a real course that expands as it goes).
  const perTopic = new Array(subject.topics.length).fill(0);
  for (let i = 0; i < count; i++) perTopic[i % subject.topics.length]++;

  const topics = [];
  let cursor = 0;
  subject.topics.forEach((topicName, topicIndex) => {
    const n = perTopic[topicIndex];
    const subtopics = [];
    for (let i = 0; i < n; i++) {
      const sec = raw[cursor++];
      const variant = VARIANTS[Math.floor(rand() * VARIANTS.length)];
      subtopics.push({
        name: `${topicName} - ${variant(i + 1)}`,
        duration: toClock(sec),
      });
    }
    topics.push({ topic: topicName, subtopics });
  });

  out[subject.name] = { instructor: subject.instructor, topics };
  totalLectures += count;
  totalSec += total;
});

function toClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 0));
console.log(
  `Wrote ${outPath}\n  subjects: ${SUBJECTS.length}\n  lectures: ${totalLectures}\n  hours: ${(
    totalSec / 3600
  ).toFixed(1)}`,
);
