# Multigás virtual — La Movida SST+

Simulador didáctico de detector multigás portátil para entrenamiento en higiene ocupacional y monitoreo de atmósferas.

## Alcance de la versión inicial

- Acceso por cédula + clave de integrante mediante `acceso_integrante`.
- Detector ficticio **MOVIDA SST+ MXG–4 PRO SIM** con apariencia propia, distinta de los otros instrumentos del laboratorio.
- Configuración 4G estándar: O₂ / %LEL / CO / H₂S.
- Configuración alternativa para fumigación: O₂ / %LEL / CO / PH₃.
- Autoprueba, FAS, Bump Test, alarmas LOW/HIGH, STEL/TWA para tóxicos, PEAK y O₂ mínimo.
- Alarmas configurables y separadas conceptualmente de los límites ocupacionales.
- Referencia higiénica opcional INSST LEP 2026 para CO, H₂S y PH₃.
- Escenarios: aire limpio, tanque estratificado, soldadura en espacio confinado, fuga combustible y fumigación con fosfina.
- Fallas didácticas: obstrucción del sensor, sensor catalítico afectado y velocidad de aire elevada.
- Reloj de exposición acelerado para practicar medias de 15 min y 8 h en una sesión breve.
- Registro local de lecturas.

## Referencias usadas para la lógica didáctica

- Manual de detector multigás ALTAIR 4XR, como referencia operacional de arranque, FAS, Bump, alarmas, rangos y comportamiento de sensores. La aplicación no reproduce marca ni diseño comercial.
- IEC/EN 60079-29-2:2015, selección, uso, comprobaciones, muestreo y mantenimiento de detectores de gases inflamables y oxígeno.
- Guía técnica de gestión del riesgo en espacios confinados del Consejo Colombiano de Seguridad, para secuencia y estrategia de monitoreo.
- INSST, **Límites de Exposición Profesional para Agentes Químicos en España 2026**, para VLA-ED/VLA-EC de CO, H₂S y fosfina.
- Fichas técnicas de sensores/equipos PH₃ de rango bajo, como referencia para rango 0–20 ppm, resolución 0,01 ppm y respuesta T90 de 15 s.

## Importante

Es una **SIMULACIÓN DIDÁCTICA**. No sustituye instrucciones del fabricante, calibración, entrenamiento práctico, procedimientos de entrada a espacios confinados ni la normativa aplicable en cada país/organización.

Dominio previsto: `https://multigas.movidasst.com`

## Revisión de usabilidad · 9 de septiembre de 2026

- POWER responde a un clic, toque, Enter o Espacio mediante el botón nativo. Omitir FAS tiene un control independiente.
- Se elimina la carga duplicada de la capa móvil y la sustitución global de temporizadores. El reloj se inicia al abrir el simulador y no acumula tiempo detrás del acceso ni con la pestaña oculta.
- Navegación móvil a Detector, Escenario y Lectura; ayuda con nombres visibles, contraste, foco por teclado, controles de al menos 44 px y respeto a movimiento reducido.
- Los pasos guiados reciben resultados del simulador (autoprueba finalizada, FAS limpio, BUMP PASS y permanencia de 15 segundos didácticos por nivel), en lugar de inferirlos de clics y textos temporizados.
- BUMP pendiente se cancela al apagar o reiniciar. Los controles incompatibles se desactivan mientras dura la prueba.
- PEAK muestra máximos de gases y mínimo de O₂. STEL/TWA muestran sus propios valores en CO y el canal tóxico, con guiones para O₂/LEL. Las marcas de alarma corresponden al estado actual del instrumento, incluso al consultar históricos.
- Selector de canal para analizar CO o H₂S/PH₃, indicación de STEL parcial y explicación de la diferencia entre tiempo acelerado y respuesta del sensor.
- STEL integra intervalos recortados a los últimos 15 min; TWA acumula concentración × minutos desde el inicio y divide entre 480. Tras más de 8 h sigue siendo un acumulado normalizado a 8 h. No desaparece exposición cuando se depura el historial STEL.
- Solo los canales instalados acumulan exposición. Cambiar perfil reinicia los indicadores y requiere repetir BUMP.
- Se rechazan alarmas vacías, negativas, invertidas o fuera del rango; las configuraciones persistidas se validan al cargar.
- Registro contextual con escenario, zona, tiempo, BUMP y falla. Los textos del registro se insertan como texto, no como HTML.

### Referencia operacional consultada

Manual aportado **MSA ALTAIR 4XR, Order No. 10175896/12, © 2025**, páginas 23–24 y 30–31: FAS, páginas de medición, prueba de alarmas y BUMP. La duración de BUMP y la espera por nivel son simplificaciones didácticas, no instrucciones temporales del equipo real. El sesgo por FAS contaminado tampoco reproduce sus límites de aceptación. Esta revisión no certifica conformidad normativa ni actualiza los valores LEP de la versión anterior.

### Verificación

`node --test tests/simulator.test.cjs` ejecuta 13 pruebas de regresión sin dependencias externas. Se prueban la autoprueba, FAS contaminado, BUMP normal/fallido/cancelado, reinicio, integración STEL/TWA, espera del sensor, páginas de lectura, configuración inválida y canales no instalados.

Comprobados además sintaxis JavaScript y `git diff --check`. La revisión visual interactiva en móvil/escritorio y el acceso real de integrantes quedan pendientes: el navegador de la sesión bloqueó la vista local. Los tests usan dobles DOM aislados y no validan diseño, servicios de acceso, sonido ni vibración en dispositivos reales.
