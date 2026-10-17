# CompensaGuardias ⏱️

Aplicación web estática (100% en cliente, HTML5, CSS3 y JavaScript moderno) para calcular y presupuestar las compensaciones de guardias localizadas a lo largo del año.

## Características

- **Calendario Laboral 2026**: Integración nativa del calendario (`calendario-2026.json`) distinguiendo días normales (327), cierres/vacaciones obligatorias (24) y festivos oficiales (14).
- **Presupuesto Configurable**: Presupuesto semanal base (600 € por defecto) sincronizado con el presupuesto anual.
- **Restricción Estricta**: Control presupuestario en tiempo real con garantía anti-desbordamiento ante redondeos de céntimos en nómina.
- **Ponderaciones Interactivas**: Ajuste de coeficientes mediante sliders e inputs numéricos para cada tipo de día con presets rápidos.
- **Calendario Anual Interactivo**: Vista de los 12 meses con selección de semanas (`W01` - `W53`) e inspección desglosada día por día.
- **Listado y Comparador**: Tabla de semanas con filtros (estándar, con festivos, con cierres) y ordenación.
- **Auditoría y Conciliación**: Matriz matemática con porcentajes de reparto y balance de seguridad.
- **Exportación e Importación**: Descarga en formato CSV y JSON, soporte para cargar otros calendarios laborales JSON e impresión amigable.

## Uso

Al ser una aplicación 100% cliente sin backend ni dependencias, basta con abrir `index.html` en cualquier navegador web moderno:

```bash
# Directamente en el navegador:
xdg-open index.html

# O sirviéndolo con un servidor HTTP local:
python3 -m http.server 8000
```
