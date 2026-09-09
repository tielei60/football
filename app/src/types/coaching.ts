export interface TrainingPlan {
  objective: string;
  instructions: string;
  durationMinutes: number;
}

export function normalizeTrainingPlan(value?: Partial<TrainingPlan> | null): TrainingPlan {
  return {
    objective: typeof value?.objective === "string" ? value.objective.slice(0, 200) : "",
    instructions: typeof value?.instructions === "string" ? value.instructions.slice(0, 4000) : "",
    durationMinutes:
      typeof value?.durationMinutes === "number" && Number.isFinite(value.durationMinutes)
        ? Math.max(1, Math.min(180, Math.round(value.durationMinutes)))
        : 15,
  };
}
