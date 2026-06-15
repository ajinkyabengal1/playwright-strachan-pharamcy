export type ConditionQuestionRule = {
  questionPattern: RegExp;
  answerText: string;
  control: "radio" | "checkbox" | "input" | "textarea" | "date";
};

export const SHINGLES_RULES: ConditionQuestionRule[] = [
  {
    questionPattern:
      /Do you have any of below symptoms\. Check all that apply/i,
    answerText: "None of the above",
    control: "checkbox",
  },
  {
    questionPattern: /Please check all that apply to you\./i,
    answerText:
      "Presentation >7 days after rash onset (outside antiviral treatment window)",
    control: "checkbox",
  },
  {
    questionPattern: /Do you have these symptoms\?/i,
    answerText: "I do not have these symptoms",
    control: "radio",
  },
];

export const WEIGHT_MANAGEMENT_RULES: ConditionQuestionRule[] = [
  {
    questionPattern:
      /Do you take any medications currently, including over-the-counter, supplements, herbal remedies\?/i,
    answerText: "No",
    control: "radio",
  },
  {
    questionPattern:
      /Do you currently have any of these symptoms\? \(Select all that apply\)/i,
    answerText: "None of the above",
    control: "checkbox",
  },
  {
    questionPattern:
      /Have you experienced any of these since your last dose\? \(Select all that apply\)/i,
    answerText: "Have you had any signs or diagnoses of pancreatitis?",
    control: "checkbox",
  },
  {
    questionPattern:
      /Have you ever made yourself sick because you felt uncomfortably full\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /In the past 6 months, have you lost control over how much you eat\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /lost more than one stone.*6\.3kg.*three-month period/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you frequently restrict eating to influence your shape or weight\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you feel food dominates your life\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have friends or family expressed concerns about your eating patterns\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you currently engage in binge eating episodes\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you have any of these.*conditions.*Tick all that apply/i,
    answerText: "History of pancreatitis",
    control: "checkbox",
  },
  {
    questionPattern: /Date of the last thyroid function test.*applicable/i,
    answerText: "01-01-2026",
    control: "date",
  },
  {
    questionPattern: /Current HbA1c.*if diabetic/i,
    answerText: "5.4",
    control: "input",
  },
  {
    questionPattern: /Blood pressure reading today.*mmHg/i,
    answerText: "120/80",
    control: "input",
  },
  {
    questionPattern:
      /Would you describe your weight gain as gradual over time or sudden\?/i,
    answerText: "Gradual",
    control: "radio",
  },
  {
    questionPattern: /How long have you been trying to manage your weight\?/i,
    answerText: "12",
    control: "input",
  },
  {
    questionPattern:
      /How much does your weight affect your daily life or well-being\?/i,
    answerText: "7",
    control: "input",
  },
  {
    questionPattern:
      /Have you ever taken any medications to help manage your weight\?/i,
    answerText: "No",
    control: "radio",
  },
  {
    questionPattern:
      /Have you attempted any of the following.*select all that apply/i,
    answerText: "Exercise program",
    control: "checkbox",
  },
  {
    questionPattern: /How do you feel about making lifestyle changes\?/i,
    answerText: "Positive and motivated",
    control: "radio",
  },
  {
    questionPattern: /Have friends\/family offered support\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you feel lifestyle changes alone could help\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Risk Level assessment:/i,
    answerText: "Low Risk (0-1 red flags, BMI 30-35)",
    control: "radio",
  },
  {
    questionPattern: /Realistic weight loss expectations discussed:/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Timeline for review appointment set:/i,
    answerText: "2 Weeks",
    control: "radio",
  },
];

export const ERECTILE_DYSFUNCTION_RULES: ConditionQuestionRule[] = [
  {
    questionPattern: /Do you have difficulty getting or keeping an erection\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have you seen a nurse, doctor or a specialist about your erectile dysfunction\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Has a doctor or medical professional ever advised you to avoid strenuous exercise\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have you ever had to stop exercise.*felt chest pain.*breathless.*dizzy.*clammy/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you ever experience dizziness or lightheadedness immediately after standing up/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Are you currently taking any other medication for erectile dysfunction\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Are your erections sometimes fine.*first thing in the morning.*watching pornography/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Are you currently experiencing any emotional or psychological problems.*stress or anxiety/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /When ordering MUSE or CAVERJECT.*Have you tried tablets already\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have you ever been shown how to use the medication you are ordering\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you have any physical abnormality of the penis/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you have any conditions which make it more likely for you to have prolonged erections/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Is there anything else that you would like to mention to our doctors/i,
    answerText: "no",
    control: "input",
  },
  {
    questionPattern:
      /Erectile dysfunction treatments can cause a fatal interactions with medicines from the 'Nitrate' family/i,
    answerText: "Please check",
    control: "checkbox",
  },
];
