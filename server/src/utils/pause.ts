let isPaused = false;

export function setPaused(value: boolean) {
  isPaused = value;
}

export function getPaused() {
  return isPaused;
}

