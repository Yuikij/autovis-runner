/**
 * 处理外键约束错误，返回友好的错误消息
 */
export function handleForeignKeyError(error: unknown, defaultMessage: string): never {
  if (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed")) {
    throw new Error(defaultMessage)
  }
  throw error
}

/**
 * 包装删除操作，自动处理外键约束错误
 */
export async function wrapDeleteOperation<T>(
  operation: () => Promise<T>,
  friendlyMessage: string,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    handleForeignKeyError(error, friendlyMessage)
  }
}
