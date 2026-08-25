import { createClient } from '@supabase/supabase-js'
import type { Store } from './types'

// Claves PÚBLICAS del proyecto (diseñadas para ir en el frontend).
// La seguridad real la da Row Level Security: cada usuario solo lee/escribe su propia fila.
const SUPABASE_URL = 'https://xwqkuolqxwfdrpoupuou.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cWt1b2xxeHdmZHJwb3VwdW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NzE1NzUsImV4cCI6MjEwMzI0NzU3NX0.YeGljeC5_Dil2BfL3ymMLAqEuc7ZC_-LxjyB9zD6o9E'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/** Sube (o actualiza) el store completo del usuario. Una fila por usuario. */
export async function pushStore(userId: string, payload: Store) {
  const { error } = await supabase.from('user_data').upsert({
    user_id: userId,
    payload,
    updated_at: new Date().toISOString(),
  })
  return error
}

/** Trae el store remoto del usuario, o null si aún no tiene datos en la nube */
export async function pullStore(userId: string) {
  const { data, error } = await supabase
    .from('user_data')
    .select('payload, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data as { payload: unknown; updated_at: string } | null
}
