/**
 * Referencia mínima de usuario para control de acceso y resolución de identidad.
 * Las incidencias no deben duplicar datos personales; aquí solo se conserva el identificador.
 */
export type UserReference = Readonly<{
  id: string;
}>;