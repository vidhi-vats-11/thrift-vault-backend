const write = (level, message, meta = {}) => {
  process.stdout.write(
    JSON.stringify({ level, message, time: new Date().toISOString(), ...meta }) + "\n"
  )
}

export const logger = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
}
