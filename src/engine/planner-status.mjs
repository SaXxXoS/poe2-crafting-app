export function classifyPlannerSimulatorResult(simulatorResult) {
  if (simulatorResult?.status === "simulated") return "simulated";
  if (simulatorResult?.status === "inapplicable") return "inapplicable";
  if (simulatorResult?.status === "unresolved") return "unresolved";
  return "error";
}
