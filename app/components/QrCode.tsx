import qrcode from "qrcode-generator";

// Drawn here, from a library bundled into the app: the node has no internet to
// ask a QR service, and a join code is exactly what must work offline.
export function QrCode({ value, label }: { value: string, label: string }) {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
            if (qr.isDark(row, col)) path += `M${col + 2},${row + 2}h1v1h-1z`;
        }
    }
    // a 2-module quiet margin on every side, which scanners need
    return (
        <svg class="qr-code" viewBox={`0 0 ${n + 4} ${n + 4}`} role="img" aria-label={label} shape-rendering="crispEdges">
            <rect width="100%" height="100%" fill="#fff" />
            <path d={path} fill="#000" />
        </svg>
    );
}
