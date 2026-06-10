export interface AlimentoINTA {
  id: string;
  nombre: string;
  calorias: number;
  proteinas: number;
  carbohidratos: number;
  grasas: number;
}

const ALIMENTOS: AlimentoINTA[] = [
  { id: "1", nombre: "Pechuga de Pollo", calorias: 165, proteinas: 31, carbohidratos: 0, grasas: 3.6 },
  { id: "2", nombre: "Arroz Integral", calorias: 362, proteinas: 7.5, carbohidratos: 76, grasas: 2.7 },
  { id: "3", nombre: "Avena", calorias: 389, proteinas: 17, carbohidratos: 66, grasas: 7 },
  { id: "4", nombre: "Huevo Entero", calorias: 155, proteinas: 13, carbohidratos: 1.1, grasas: 11 },
  { id: "5", nombre: "Whey Protein", calorias: 380, proteinas: 75, carbohidratos: 8, grasas: 5 },
];

export function buscarAlimento(query: string): AlimentoINTA[] {
  const q = query.toLowerCase();
  return ALIMENTOS.filter(a => a.nombre.toLowerCase().includes(q));
}

export default ALIMENTOS;
