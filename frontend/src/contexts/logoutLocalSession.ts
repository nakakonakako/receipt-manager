export type LocalSignOutOptions = {
  scope: 'local'
}

export type LogoutLocalSessionDependencies = {
  setOwner: (userId: null) => void
  signOut: (options: LocalSignOutOptions) => Promise<unknown>
}

export async function logoutLocalSession({
  setOwner,
  signOut,
}: LogoutLocalSessionDependencies): Promise<void> {
  setOwner(null)
  await signOut({ scope: 'local' })
}
