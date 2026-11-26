# Diseño de la app (mínimo)

Superficie de tipo *Operate*: una app de tareas personal. Manda la claridad; la
marca vive en los detalles, no en la decoración.

- **Tema:** Material 3 (`material_ui`), claro y oscuro, con color semilla
  `#3F6FD8` (`lib/core/theme.dart`). Colores siempre por rol del esquema
  (`primary`, `errorContainer`, `secondaryContainer`...), nunca hexadecimales sueltos.
- **Tipografía:** la escala de Material (`headlineSmall` para títulos de pantalla,
  `titleMedium` para secciones, `bodyMedium` para el texto). Sin tamaños a mano.
- **Controles:** botones de 48 dp de alto como mínimo; campos `OutlineInputBorder`
  con etiqueta flotante; un único botón principal (`FilledButton`) por formulario.
- **Formularios:** columna única de 420 dp como máximo, desplazable; Enter en el
  último campo envía; la validación local aparece al enviar y los errores del
  servidor se mapean por `code` (`lib/core/errores.dart`), en el campo
  correspondiente si lo hay (usuario ocupado, contraseña actual o nueva) y, si no,
  en un aviso en línea.
- **Estados:** espera (círculo dentro del botón, que queda desactivado), error
  (`AvisoDeError`, con "Reintentar" si es de red o de servidor), información
  (`AvisoInformativo`). Los avisos se anuncian a los lectores de pantalla.
- **Movimiento:** solo el de los componentes de Material; nada decorativo.
