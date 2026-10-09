export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!shouldRetryWithTypeScriptExtension(specifier, error)) throw error
    return nextResolve(`${specifier}.ts`, context)
  }
}

function shouldRetryWithTypeScriptExtension(specifier, error) {
  return error?.code === 'ERR_MODULE_NOT_FOUND'
    && (specifier.startsWith('./') || specifier.startsWith('../'))
    && !specifier.endsWith('.ts')
}
