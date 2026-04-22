export type CheckerOutcome = {
  status: 'accepted' | 'wrong_answer' | 'internal_error';
  message?: string;
};
