export type Diaper = {
  id: string;
  occurred_at: string;
  pee: boolean;
  poo: boolean;
  poo_level: 1 | 2 | 3 | null;
  note: string | null;
};

export type Feeding = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  side: "G" | "D" | null;
};
