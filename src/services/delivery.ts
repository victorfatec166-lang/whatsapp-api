import axios from 'axios';
import { prisma } from '../database/prisma';

const FALLBACK_CONFIG = {
    originAddress: 'Rua Principal, 100 - Mogi Mirim, SP',
    feePerKm: 2.50,
    baseFee: 3.00,
    googleApiKey: ''
};

export async function calculateDeliveryFee(destinationAddress: string): Promise<{ distanceKm: number; fee: number }> {
    const config = await prisma.config.findUnique({ where: { id: 'default' } })
        .catch((error) => {
            console.error('Erro ao ler configurações de entrega:', error);
            return null;
        }) ?? FALLBACK_CONFIG;

    const { originAddress, feePerKm, baseFee, googleApiKey } = config;

    if (googleApiKey && googleApiKey.trim() !== '') {
        try {
            const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originAddress)}&destinations=${encodeURIComponent(destinationAddress)}&key=${googleApiKey}`;
            const response = await axios.get(url, { timeout: 5000 });

            if (response.data.rows[0]?.elements[0]?.status === 'OK') {
                const distanceMeters = response.data.rows[0].elements[0].distance.value;
                const distanceKm = distanceMeters / 1000;
                const fee = baseFee + (distanceKm * feePerKm);
                return { distanceKm: Number(distanceKm.toFixed(2)), fee: Number(fee.toFixed(2)) };
            }
        } catch (error) {
            console.error('Erro ao consultar Google Maps API, usando estimativa padrão:', error);
        }
    }

    // Fallback padrão se não houver chave ou falhar
    const estimatedKm = 3.5;
    const fee = baseFee + (estimatedKm * feePerKm);
    return { distanceKm: estimatedKm, fee: Number(fee.toFixed(2)) };
}
