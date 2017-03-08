export const randomIndex = <T> (arr: Array<T>): number => {
	return Math.floor(Math.random() * arr.length);
};
export const pickRandom = <T> (arr: Array<T>): T => arr[randomIndex(arr)];
export const delay = (ms: number) => {
	return new Promise((resolve: () => void, reject: () => void) => {
		setTimeout(resolve, ms);
	});
};
export const shuffle = <T>(arr: Array<T>): Array<T> => {
	for (let i = arr.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = arr[i];
		arr[i] = arr[j];
		arr[j] = temp;
	}
	return arr;
};
export const pickFirst = <T>(arr: Array<T>): T => arr[0];
export const logReturn = <T>(message?: T, ...optionalParams: Array<any>) => { console.log(message, ...optionalParams); return message; }; // eslint-disable-line
