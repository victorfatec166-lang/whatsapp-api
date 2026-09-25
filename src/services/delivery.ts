import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function calculateDeliveryFee(destinationAddress: string): Promise<{ distanceKm: number; fee: number }> {
  let config = await prisma.config.findUnique({ where: { id: 'default' } });

  if (!config) {
    config = await prisma.config.create({
      data: { id: 'default' }
    });
  }

  const { originAddress, feePerKm, baseFee, googleApiKey } = config;

  if (googleApiKey && googleApiKey.trim() !== '') {
    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originAddress)}&destinations=${encodeURIComponent(destinationAddress)}&key=${googleApiKey}`;
      const response = await axios.get(url);

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