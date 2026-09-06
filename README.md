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
